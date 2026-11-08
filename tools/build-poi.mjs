#!/usr/bin/env node
/* 旅冊地點庫產生器
 * 從 OpenStreetMap（Overpass API）抓日本各都道府縣的景點、寺社、餐廳、咖啡、店家、住宿、車站，
 * 用 Wikidata 補繁體中文名稱，輸出到 poi/ 給網站當靜態檔案（瀏覽器端搜尋，不經過伺服器）。
 *
 * 用法（在網站資料夾裡，需要 Node.js 18 以上）：
 *   node tools/build-poi.mjs            → 建立還沒做過的縣（第一次全日本約 1～2 小時；中斷後再跑會接著做）
 *   node tools/build-poi.mjs tokyo      → 只重做東京
 *   node tools/build-poi.mjs --all      → 全部重新抓最新資料
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

// 收錄範圍：日本 47 都道府縣（admin_level=4）。id 也是網站上用的代號；新增其他國家時照格式加。
const JP = [['hokkaido','北海道','北海道'],['aomori','青森県','青森縣'],['iwate','岩手県','岩手縣'],['miyagi','宮城県','宮城縣'],['akita','秋田県','秋田縣'],['yamagata','山形県','山形縣'],['fukushima','福島県','福島縣'],
  ['ibaraki','茨城県','茨城縣'],['tochigi','栃木県','栃木縣'],['gunma','群馬県','群馬縣'],['saitama','埼玉県','埼玉縣'],['chiba','千葉県','千葉縣'],['tokyo','東京都','東京都'],['kanagawa','神奈川県','神奈川縣'],
  ['niigata','新潟県','新潟縣'],['toyama','富山県','富山縣'],['ishikawa','石川県','石川縣'],['fukui','福井県','福井縣'],['yamanashi','山梨県','山梨縣'],['nagano','長野県','長野縣'],['gifu','岐阜県','岐阜縣'],
  ['shizuoka','静岡県','靜岡縣'],['aichi','愛知県','愛知縣'],['mie','三重県','三重縣'],['shiga','滋賀県','滋賀縣'],['kyoto','京都府','京都府'],['osaka','大阪府','大阪府'],['hyogo','兵庫県','兵庫縣'],
  ['nara','奈良県','奈良縣'],['wakayama','和歌山県','和歌山縣'],['tottori','鳥取県','鳥取縣'],['shimane','島根県','島根縣'],['okayama','岡山県','岡山縣'],['hiroshima','広島県','廣島縣'],['yamaguchi','山口県','山口縣'],
  ['tokushima','徳島県','德島縣'],['kagawa','香川県','香川縣'],['ehime','愛媛県','愛媛縣'],['kochi','高知県','高知縣'],['fukuoka','福岡県','福岡縣'],['saga','佐賀県','佐賀縣'],['nagasaki','長崎県','長崎縣'],
  ['kumamoto','熊本県','熊本縣'],['oita','大分県','大分縣'],['miyazaki','宮崎県','宮崎縣'],['kagoshima','鹿児島県','鹿兒島縣'],['okinawa','沖縄県','沖繩縣']];
export const REGIONS = JP.map(([id, ja, zh]) => ({ id, name: ja, zh, country: 'jp', area: `["name"="${ja}"]["boundary"="administrative"]["admin_level"="4"]` }));

// 一個縣分三次查（餐飲／店家／其他）。查不動（伺服器忙、逾時、記憶體不夠）時自動把範圍切成四塊再查，最多切 4 層
const F = [['nwr["amenity"~"^(restaurant|cafe|fast_food|food_court|bar|pub|ice_cream)$"]["name"]'], ['nwr["shop"]["name"]'],
  ['nwr["tourism"~"^(attraction|museum|gallery|viewpoint|zoo|aquarium|theme_park|hotel|hostel|guest_house)$"]["name"]', 'nwr["amenity"~"^(place_of_worship|marketplace)$"]["name"]',
   'nwr["leisure"~"^(park|garden)$"]["name"]', 'nwr["railway"="station"]["name"]', 'nwr["historic"~"^(castle|ruins|archaeological_site|monument|memorial)$"]["name"]']];
// 宣告的 timeout 越大，伺服器越晚排到；180 秒以內優先權比較高
export const query = (area, f, bb) => `[out:json][timeout:180];area${area}->.a;(${f.map(x => `${x}(area.a)${bb ? `(${bb.map(n => n.toFixed(4)).join(',')})` : ''};`).join('')});out center tags;`;
export const queries = area => F.map(f => query(area, f));
export const quarter = ([s, w, n, e]) => { const m = (s + n) / 2, c = (w + e) / 2; return [[s, w, m, c], [s, c, m, e], [m, w, n, c], [m, c, n, e]]; };

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

const sleep = ms => new Promise(r => setTimeout(r, process.env.POI_FAST ? 0 : ms)); // 測試時不等
// 公開的 Overpass 伺服器（https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances），輪流用
export const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.osm.jp/api/interpreter'];
let ep = 0, fails = 0;
export class TooBig extends Error {}   // 這塊範圍太大（逾時、記憶體不夠）→ 切小再查
export class Busy extends Error {}     // 伺服器忙 → 等一下再查
export class Down extends Error {}     // 連續失敗太多次 → 整個停下來，晚點再跑
export const resetFails = () => { fails = 0; };
// rounds：三台都試過算一輪
export async function overpass(q, rounds = 1, f = fetch) {
  let last = '', big = false;
  for (let k = 0; k < rounds * ENDPOINTS.length; k++) {
    const u = ENDPOINTS[ep % ENDPOINTS.length], host = new URL(u).host;
    try {
      const r = await f(u, { method: 'POST', headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(240000) });
      if (r.ok) {
        const j = await r.json();
        // 逾時或記憶體不夠時，伺服器仍回 200，但資料不完整，remark 會寫原因
        if (j.remark && /error|timed out|out of memory/i.test(j.remark)) { last = j.remark; big = true; console.log(`  ${host}：這塊太大（${j.remark.slice(0, 70)}）`); }
        else { fails = 0; return j; }
      } else {
        last = 'HTTP ' + r.status; if (r.status === 504) big = true;
        console.log(`  ${host} 回 ${r.status}${r.status === 429 ? '（查太頻繁）' : r.status === 504 ? '（逾時）' : '（伺服器忙）'}，換下一台…`);
      }
    } catch (e) { last = e.message; if (e.name === 'TimeoutError') big = true; console.log(`  ${host} 連線失敗（${e.name === 'TimeoutError' ? '等太久' : e.message}），換下一台…`); }
    if (++fails >= 15) throw new Down('三台 Overpass 伺服器連續 15 次都失敗，應該是都很忙。晚點再跑一次同樣的指令，會從沒做完的接著做');
    ep++;
    await sleep((k + 1) % ENDPOINTS.length ? 5000 : 30000);
  }
  throw big ? new TooBig(last) : new Busy(last);
}
// 先整縣查；太大就切四塊，每塊再太大再切，最多 3 層（64 塊）
const MAXD = 3;
async function fetchArea(area, f, bb, depth, out, f2, tries = 0) {
  try { const j = await overpass(query(area, f, bb), 1, f2); for (const e of j.elements) out.push(e); }
  catch (e) {
    if (e instanceof Busy && tries < 2) { console.log('  三台都忙，等 2 分鐘再試…'); await sleep(120000); return fetchArea(area, f, bb, depth, out, f2, tries + 1); }
    if (!(e instanceof TooBig) || !bb || depth >= MAXD) throw e;
    console.log(`  → 範圍切成 4 塊分開查（第 ${depth + 1} 層）`);
    for (const b of quarter(bb)) { await fetchArea(area, f, b, depth + 1, out, f2); await sleep(2000); }
  }
}
export async function fetchRegion(area, bb, f2 = fetch) {
  const out = [];
  for (const f of F) { await fetchArea(area, f, bb, 0, out, f2); await sleep(3000); }
  return out;
}
async function bboxOf(area) {
  const j = await overpass(`[out:json][timeout:60];rel${area};out bb;`, 3);
  const b = j.elements?.[0]?.bounds; if (!b) throw new Error('找不到這個行政區的邊界');
  return [b.minlat, b.minlon, b.maxlat, b.maxlon];
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
  const rows = [], seen = new Map();
  for (const e of elements) {
    const t = e.tags || {}; const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon;
    if (!t.name || lat == null) continue;
    if (t.shop && SHOP_SKIP.has(t.shop)) continue;
    if (e.type === 'relation' && (t.railway || t.route)) continue; // 鐵路路線不是地點
    if (/^(memorial|monument)$/.test(t.historic || '') && !t.wikidata && !t.tourism) continue; // 路邊石碑太多，只留有名的
    const w = t.wikidata && wd[t.wikidata];
    const zhRaw = t['name:zh-Hant'] || t['name:zh-TW'] || '';
    const zh = w?.t || (zhRaw ? conv(zhRaw, M.s2tw) : '') || (w?.s ? conv(w.s, M.s2tw) : '') || (t['name:zh'] ? conv(t['name:zh'], M.s2tw) : '');
    const area = t['addr:suburb'] || t['addr:city_district'] || t['addr:city'] || t['addr:town'] || '';
    const addr = [t['addr:province'], t['addr:city'], t['addr:suburb'], t['addr:quarter'], t['addr:neighbourhood'], t['addr:block_number'] || t['addr:housenumber']].filter(Boolean).join(' ');
    const extra = [t['name:ja-Hira'], t.alt_name].filter(Boolean).join(';');
    const row = [t.name, t['name:ja'] && t['name:ja'] !== t.name ? t['name:ja'] : '', zh && zh !== t.name ? zh : '', t['name:en'] || '', r5(lat), r5(lng), catOf(t), typeOf(t), area, addr, t.opening_hours || '', t.wikidata || '', extra];
    // 同名、相距 60 公尺內視為同一地點（同一間店常同時有點和面）
    const same = seen.get(row[0]) || [];
    if (same.some(s => km(s[4], s[5], row[4], row[5]) < 0.06)) continue;
    same.push(row); seen.set(row[0], same);
    while (row.length && row[row.length - 1] === '') row.pop();
    rows.push(row);
  }
  // 範圍取 0.5%～99.5% 的點：縣有離島（東京的小笠原、沖繩的石垣），用全部點會讓範圍大到沒意義；離島的點仍然收錄
  const pct = (a, q) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.max(0, Math.round((b.length - 1) * q)))]; };
  const la = rows.map(r => r[4]), lo = rows.map(r => r[5]);
  return { v: 1, id: region.id, name: region.name, country: region.country, built: new Date().toISOString().slice(0, 10),
    src: '© OpenStreetMap contributors', license: 'ODbL 1.0 — https://opendatacommons.org/licenses/odbl/ ・ https://www.openstreetmap.org/copyright',
    bbox: rows.length ? [pct(la, .005), pct(lo, .005), pct(la, .995), pct(lo, .995)] : null, n: rows.length,
    cols: ['name', 'ja', 'zh', 'en', 'lat', 'lng', 'cat', 'type', 'area', 'addr', 'hours', 'wikidata', 'alt'], rows };
}

async function buildOne(region) {
  console.log(`▶ ${region.name}：向 OpenStreetMap 查詢（分 3 次，大縣可能要 10 分鐘以上）…`);
  const bb = await bboxOf(region.area);
  const seen = new Set(), els = [];
  for (const e of await fetchRegion(region.area, bb)) { const k = e.type + e.id; if (!seen.has(k)) { seen.add(k); els.push(e); } } // 切塊時邊界上的會重複
  const j = { elements: els };
  await fs.mkdir(CACHE, { recursive: true });
  await fs.writeFile(path.join(CACHE, region.id + '.osm.json'), JSON.stringify(j));
  const ids = [...new Set(j.elements.map(e => e.tags?.wikidata).filter(x => /^Q\d+$/.test(x || '')))];
  console.log(`  取得 ${j.elements.length} 筆；向 Wikidata 查 ${ids.length} 筆的中文名稱…`);
  const wd = await wikidataLabels(ids);
  const out = await compact(region, j.elements, wd);
  const s = JSON.stringify(out);
  await fs.writeFile(path.join(OUT, region.id + '.json'), s);
  console.log(`  完成：收錄 ${out.n} 筆，檔案 ${(s.length / 1e6).toFixed(1)} MB`);
  if (s.length > 24e6) console.log('  ⚠ 檔案超過 24 MB，Cloudflare 單檔上限 25 MiB，要再拆小');
  return { id: region.id, name: region.name, zh: region.zh, country: region.country, bbox: out.bbox, n: out.n, built: out.built, file: `poi/${region.id}.json` };
}

async function main() {
  const args = process.argv.slice(2), all = args.includes('--all'), want = args.filter(a => !a.startsWith('--'));
  await fs.mkdir(OUT, { recursive: true });
  let index = { v: 1, regions: [] };
  try { index = JSON.parse(await fs.readFile(path.join(OUT, 'index.json'), 'utf8')); } catch (e) {}
  // 舊版是以「市」為單位（kobe…），不在清單裡的一律清掉
  index.regions = (index.regions || []).filter(r => REGIONS.some(x => x.id === r.id && x.name === r.name));
  for (const f of await fs.readdir(OUT)) if (/\.json$/.test(f) && !['index.json', 'norm.json'].includes(f) && !index.regions.some(r => r.id + '.json' === f) && !REGIONS.some(r => r.id + '.json' === f)) await fs.unlink(path.join(OUT, f));
  // 不指定時只做還沒做過的（中斷後再跑一次會接著做）；--all 全部重做；指定代號只做那幾個
  const list = want.length ? REGIONS.filter(r => want.includes(r.id)) : all ? REGIONS : REGIONS.filter(r => !index.regions.some(x => x.id === r.id));
  if (want.length && !list.length) { console.log('沒有這個代號。可用：' + REGIONS.map(r => r.id).join(', ')); process.exit(1); }
  if (!list.length) console.log('全部都已經建好了。要重新抓最新資料請加 --all，或指定代號，例如：node tools/build-poi.mjs tokyo');
  let k = 0;
  for (const r of list) {
    console.log(`\n[${++k}/${list.length}]`);
    try {
      const info = await buildOne(r); index.regions = index.regions.filter(x => x.id !== r.id).concat(info);
      index.regions.sort((a, b) => REGIONS.findIndex(x => x.id === a.id) - REGIONS.findIndex(x => x.id === b.id));
      await fs.writeFile(path.join(OUT, 'index.json'), JSON.stringify(index, null, 1)); // 每做完一個就存，中斷也不會白做
    } catch (e) { console.log(`✖ ${r.name} 失敗：${e.message}（之後再跑一次同樣的指令會補做）`); if (e instanceof Down) break; }
    resetFails();
    await sleep(5000); // Overpass 的使用禮節：別連續猛打
  }
  index.regions.sort((a, b) => REGIONS.findIndex(x => x.id === a.id) - REGIONS.findIndex(x => x.id === b.id));
  index.src = '© OpenStreetMap contributors'; index.license = 'ODbL 1.0 — https://www.openstreetmap.org/copyright';
  await fs.writeFile(path.join(OUT, 'index.json'), JSON.stringify(index, null, 1));
  const M = await cjk();
  await fs.writeFile(path.join(OUT, 'norm.json'), JSON.stringify({ jp2t: M.jp2t, t2s: M.t2s }));
  await fs.writeFile(path.join(OUT, 'LICENSE.txt'), '旅冊地點庫（poi/*.json）由 OpenStreetMap 資料產生。\nData © OpenStreetMap contributors, available under the Open Database License (ODbL) 1.0.\nhttps://www.openstreetmap.org/copyright\nhttps://opendatacommons.org/licenses/odbl/\n本資料庫同樣以 ODbL 1.0 提供。繁體中文名稱部分來自 Wikidata（CC0）。\n');
  const miss = REGIONS.filter(r => !index.regions.some(x => x.id === r.id));
  console.log(`\n完成。poi/ 裡有 ${index.regions.length} 個地區${miss.length ? `，還缺 ${miss.map(r => r.name).join('、')}（再跑一次同樣的指令會補做）` : ''}。接著執行：npx wrangler deploy`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
