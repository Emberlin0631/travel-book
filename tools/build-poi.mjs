#!/usr/bin/env node
/* 旅冊地點庫產生器
 * 從 OpenStreetMap（Overpass API）抓指定城市的景點、寺社、餐廳、咖啡、店家、住宿、車站，
 * 用 Wikidata 補繁體中文名稱，輸出到 poi/ 給網站當靜態檔案（瀏覽器端搜尋，不經過伺服器）。
 *
 * 用法（在網站資料夾裡，需要 Node.js 18 以上）：
 *   node tools/build-poi.mjs            → 建立全部城市
 *   node tools/build-poi.mjs kyoto      → 只更新京都
 * 跑完再 npx wrangler deploy。建議每 1～3 個月更新一次。
 *
 * 授權：資料 © OpenStreetMap contributors，以 ODbL 1.0 授權；輸出的 poi/*.json 是衍生資料庫，同樣以 ODbL 公開。
 * Wikidata 的名稱為 CC0。tools/cjk-map.json 由 OpenCC（Apache-2.0）的對照表產生。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'poi');
const CACHE = path.join(ROOT, 'tools', 'cache');
const UA = 'TravelBook-POI-builder/1.0 (https://github.com/Emberlin0631/travel-book)';

// 要收錄的城市。area 是 Overpass 的行政區條件；日本的市町村是 admin_level=7。新增城市照格式加一行即可。
export const REGIONS = [
  { id: 'kyoto', name: '京都市', country: 'jp', area: '["name"="京都市"]["boundary"="administrative"]["admin_level"="7"]' },
  { id: 'osaka', name: '大阪市', country: 'jp', area: '["name"="大阪市"]["boundary"="administrative"]["admin_level"="7"]' },
  { id: 'nara', name: '奈良市', country: 'jp', area: '["name"="奈良市"]["boundary"="administrative"]["admin_level"="7"]' },
  { id: 'kobe', name: '神戸市', country: 'jp', area: '["name"="神戸市"]["boundary"="administrative"]["admin_level"="7"]' },
];

export const query = area => `[out:json][timeout:240];area${area}->.a;(
nwr["tourism"~"^(attraction|museum|gallery|viewpoint|zoo|aquarium|theme_park|hotel|hostel|guest_house)$"]["name"](area.a);
nwr["amenity"~"^(restaurant|cafe|fast_food|food_court|bar|pub|ice_cream|place_of_worship|marketplace)$"]["name"](area.a);
nwr["shop"]["name"](area.a);
nwr["leisure"~"^(park|garden)$"]["name"](area.a);
nwr["railway"="station"]["name"](area.a);
nwr["historic"~"^(castle|ruins|archaeological_site|monument|memorial)$"]["name"](area.a););
out center tags;`;

// 觀光客幾乎不會去的店家類型（美髮、修車、洗衣…），不收
const SHOP_SKIP = new Set(['hairdresser', 'beauty', 'massage', 'car', 'car_repair', 'car_parts', 'tyres', 'motorcycle', 'motorcycle_repair', 'bicycle', 'dry_cleaning', 'laundry',
  'optician', 'mobile_phone', 'funeral_directors', 'estate_agent', 'insurance', 'hearing_aids', 'medical_supply', 'doityourself', 'hardware', 'trade', 'fuel', 'gas', 'storage_rental',
  'pawnbroker', 'money_lender', 'lottery', 'copyshop', 'photo_studio', 'tailor', 'shoe_repair', 'locksmith', 'appliance', 'electrical', 'paint', 'flooring', 'kitchen', 'bathroom_furnishing',
  'agrarian', 'garden_centre', 'pet_grooming', 'nutrition_supplements', 'e-cigarette', 'tobacco', 'vacant', 'no', 'convenience', 'kiosk', 'travel_agency', 'rental', 'video_games', 'computer']);

export function catOf(t) {
  if (t.railway === 'station') return 'train';
  if (/^(hotel|hostel|guest_house)$/.test(t.tourism || '')) return 'hotel';
  if (/^(museum|gallery|aquarium)$/.test(t.tourism || '')) return 'museum';
  if (t.amenity === 'place_of_worship') return t.religion === 'shinto' ? 'shrine' : 'temple';
  if (/^(restaurant|fast_food|food_court|bar|pub)$/.test(t.amenity || '')) return 'food';
  if (/^(cafe|ice_cream)$/.test(t.amenity || '') || /^(confectionery|bakery|pastry|tea|coffee|chocolate)$/.test(t.shop || '')) return 'cafe';
  if (t.shop || t.amenity === 'marketplace') return 'shop';
  if (t.leisure || t.tourism === 'viewpoint') return 'nature';
  return 'city';
}
const typeOf = t => t.railway ? 'station' : t.tourism || t.amenity || (t.shop ? 'shop:' + t.shop : '') || t.leisure || t.historic || '';

let MAP = null;
async function cjk() { if (!MAP) MAP = JSON.parse(await fs.readFile(path.join(ROOT, 'tools', 'cjk-map.json'), 'utf8')); return MAP; }
const maps = new WeakMap();
const mapOf = pair => { let m = maps.get(pair); if (!m) { const A = [...pair[0]], B = [...pair[1]]; m = new Map(A.map((c, i) => [c, B[i]])); maps.set(pair, m); } return m; }; // 用字元陣列，避免擴充區字元（兩個 UTF-16 單位）讓位置錯開
const conv = (s, pair) => { if (!s) return s; const m = mapOf(pair); let o = ''; for (const ch of s) o += m.get(ch) ?? ch; return o; };

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function overpass(q) {
  for (let k = 0; k < 6; k++) {
    try {
      const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q) });
      if (r.ok) return await r.json();
      console.log(`  Overpass 回 ${r.status}（伺服器忙），${20 * 2 ** k} 秒後重試…`);
    } catch (e) { console.log(`  連線失敗（${e.message}），${20 * 2 ** k} 秒後重試…`); }
    await sleep(20000 * 2 ** k);
  }
  throw new Error('Overpass 一直沒有回應，稍後再跑一次');
}
async function wikidataLabels(ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 50) {
    const u = 'https://www.wikidata.org/w/api.php?' + new URLSearchParams({ action: 'wbgetentities', ids: ids.slice(i, i + 50).join('|'), props: 'labels', languages: 'zh-tw|zh-hant|zh', format: 'json' });
    for (let k = 0; k < 4; k++) {
      try {
        const r = await fetch(u, { headers: { 'user-agent': UA } });
        if (r.status === 429) { await sleep(5000 * (k + 1)); continue; }
        const j = await r.json();
        for (const [q, e] of Object.entries(j.entities || {})) { const L = e.labels || {}; const v = L['zh-tw'] || L['zh-hant']; out[q] = v ? { t: v.value } : L.zh ? { s: L.zh.value } : null; }
        break;
      } catch (e) { await sleep(3000); }
    }
    await sleep(300);
  }
  return out;
}

const r5 = x => Math.round(x * 1e5) / 1e5;
const km = (a, b, c, d) => Math.hypot((a - c) * 111, (b - d) * 111 * Math.cos(a * Math.PI / 180));

/* 一筆 = [名稱, 日文名, 繁中名, 英文名, 緯度, 經度, 類別, 細類, 區, 地址, 營業時間, Wikidata, 平假名/別名]（尾端空白欄位省略） */
export async function compact(region, elements, wd = {}) {
  const M = await cjk();
  const rows = [], seen = [];
  for (const e of elements) {
    const t = e.tags || {}; const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon;
    if (!t.name || lat == null) continue;
    if (t.shop && SHOP_SKIP.has(t.shop)) continue;
    if (e.type === 'relation' && (t.railway || t.route)) continue; // 鐵路路線不是地點
    if (/^(memorial|monument)$/.test(t.historic || '') && !t.wikidata && !t.tourism) continue; // 路邊石碑太多，只留有名的
    const w = t.wikidata && wd[t.wikidata];
    const zhRaw = t['name:zh-Hant'] || t['name:zh-TW'] || '';
    const zh = w?.t || (zhRaw ? conv(zhRaw, M.s2tw) : '') || (w?.s ? conv(w.s, M.s2tw) : '') || (t['name:zh'] ? conv(t['name:zh'], M.s2tw) : '');
    const area = t['addr:suburb'] || t['addr:city_district'] || '';
    const addr = [t['addr:province'], t['addr:city'], t['addr:suburb'], t['addr:quarter'], t['addr:neighbourhood'], t['addr:block_number'] || t['addr:housenumber']].filter(Boolean).join(' ');
    const extra = [t['name:ja-Hira'], t.alt_name].filter(Boolean).join(';');
    const row = [t.name, t['name:ja'] && t['name:ja'] !== t.name ? t['name:ja'] : '', zh && zh !== t.name ? zh : '', t['name:en'] || '', r5(lat), r5(lng), catOf(t), typeOf(t), area, addr, t.opening_hours || '', t.wikidata || '', extra];
    // 同名、相距 60 公尺內視為同一地點（同一間店常同時有點和面）
    if (seen.some(s => s[0] === row[0] && km(s[4], s[5], row[4], row[5]) < 0.06)) continue;
    seen.push(row);
    while (row.length && row[row.length - 1] === '') row.pop();
    rows.push(row);
  }
  // 長條形的路線（例：山陽新幹線被標成車站）中心點會落在幾百公里外，離城市中位數太遠的丟掉，免得範圍被撐大
  const med = a => { const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; };
  const mLa = med(rows.map(r => r[4])), mLo = med(rows.map(r => r[5]));
  for (let i = rows.length - 1; i >= 0; i--) if (km(rows[i][4], rows[i][5], mLa, mLo) > 60) rows.splice(i, 1);
  const la = rows.map(r => r[4]), lo = rows.map(r => r[5]);
  return { v: 1, id: region.id, name: region.name, country: region.country, built: new Date().toISOString().slice(0, 10),
    src: '© OpenStreetMap contributors', license: 'ODbL 1.0 — https://opendatacommons.org/licenses/odbl/ ・ https://www.openstreetmap.org/copyright',
    bbox: rows.length ? [Math.min(...la), Math.min(...lo), Math.max(...la), Math.max(...lo)] : null, n: rows.length,
    cols: ['name', 'ja', 'zh', 'en', 'lat', 'lng', 'cat', 'type', 'area', 'addr', 'hours', 'wikidata', 'alt'], rows };
}

async function buildOne(region) {
  console.log(`▶ ${region.name}：向 OpenStreetMap 查詢（可能要 1～3 分鐘）…`);
  const j = await overpass(query(region.area));
  await fs.mkdir(CACHE, { recursive: true });
  await fs.writeFile(path.join(CACHE, region.id + '.osm.json'), JSON.stringify(j));
  const ids = [...new Set(j.elements.map(e => e.tags?.wikidata).filter(x => /^Q\d+$/.test(x || '')))];
  console.log(`  取得 ${j.elements.length} 筆；向 Wikidata 查 ${ids.length} 筆的中文名稱…`);
  const wd = await wikidataLabels(ids);
  const out = await compact(region, j.elements, wd);
  const s = JSON.stringify(out);
  await fs.writeFile(path.join(OUT, region.id + '.json'), s);
  console.log(`  完成：收錄 ${out.n} 筆，檔案 ${(s.length / 1e6).toFixed(1)} MB`);
  return { id: region.id, name: region.name, country: region.country, bbox: out.bbox, n: out.n, built: out.built, file: `poi/${region.id}.json` };
}

async function main() {
  const want = process.argv.slice(2);
  const list = want.length ? REGIONS.filter(r => want.includes(r.id)) : REGIONS;
  if (!list.length) { console.log('沒有這個城市代號。可用：' + REGIONS.map(r => r.id).join(', ')); process.exit(1); }
  await fs.mkdir(OUT, { recursive: true });
  let index = { v: 1, regions: [] };
  try { index = JSON.parse(await fs.readFile(path.join(OUT, 'index.json'), 'utf8')); } catch (e) {}
  for (const r of list) {
    try { const info = await buildOne(r); index.regions = index.regions.filter(x => x.id !== r.id).concat(info); }
    catch (e) { console.log(`✖ ${r.name} 失敗：${e.message}`); }
    await sleep(5000); // Overpass 的使用禮節：別連續猛打
  }
  index.regions.sort((a, b) => REGIONS.findIndex(x => x.id === a.id) - REGIONS.findIndex(x => x.id === b.id));
  index.src = '© OpenStreetMap contributors'; index.license = 'ODbL 1.0 — https://www.openstreetmap.org/copyright';
  await fs.writeFile(path.join(OUT, 'index.json'), JSON.stringify(index, null, 1));
  const M = await cjk();
  await fs.writeFile(path.join(OUT, 'norm.json'), JSON.stringify({ jp2t: M.jp2t, t2s: M.t2s }));
  await fs.writeFile(path.join(OUT, 'LICENSE.txt'), '旅冊地點庫（poi/*.json）由 OpenStreetMap 資料產生。\nData © OpenStreetMap contributors, available under the Open Database License (ODbL) 1.0.\nhttps://www.openstreetmap.org/copyright\nhttps://opendatacommons.org/licenses/odbl/\n本資料庫同樣以 ODbL 1.0 提供。繁體中文名稱部分來自 Wikidata（CC0）。\n');
  console.log(`\n全部完成。poi/ 裡有 ${index.regions.length} 個城市。接著執行：npx wrangler deploy`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
