// node --test test/ —— 旅冊地點庫產生器（tools/build-poi.mjs）的資料整理
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compact, catOf } from '../tools/build-poi.mjs';

const E = (tags, lat = 35, lon = 135.7, type = 'node') => ({ type, lat, lon, tags });

test('catOf：寺社、餐廳、甜點店、住宿、車站', () => {
  assert.equal(catOf({ amenity: 'place_of_worship', religion: 'shinto' }), 'shrine');
  assert.equal(catOf({ amenity: 'place_of_worship', religion: 'buddhist' }), 'temple');
  assert.equal(catOf({ amenity: 'restaurant' }), 'food');
  assert.equal(catOf({ shop: 'confectionery' }), 'cafe');
  assert.equal(catOf({ tourism: 'hotel' }), 'hotel');
  assert.equal(catOf({ railway: 'station' }), 'train');
  assert.equal(catOf({ shop: 'wool' }), 'shop');
});

test('compact：過濾美髮店與路邊石碑、簡體轉繁體、Wikidata 名稱優先、同名鄰近去重', async () => {
  const out = await compact({ id: 't', name: '京都市', country: 'jp' }, [
    E({ name: 'HUG', shop: 'hairdresser' }),
    E({ name: '某某跡', historic: 'memorial' }),
    E({ name: '京都タワー', 'name:zh': '京都观光塔', tourism: 'viewpoint', opening_hours: 'Mo-Su 10:00-21:00' }),
    E({ name: '伏見稲荷大社', amenity: 'place_of_worship', religion: 'shinto', wikidata: 'Q11488' }, 34.9671, 135.7727),
    E({ name: '店A', shop: 'confectionery' }, 34.96783, 135.77197),
    { type: 'way', center: { lat: 34.9678, lon: 135.77197 }, tags: { name: '店A', shop: 'confectionery' } },
  ], { Q11488: { t: '伏見稻荷大社' } });
  assert.equal(out.n, 3);
  const [tower, inari, shop] = out.rows;
  assert.equal(tower[2], '京都觀光塔');
  assert.equal(tower[10], 'Mo-Su 10:00-21:00');
  assert.equal(inari[2], '伏見稻荷大社');
  assert.equal(inari[6], 'shrine');
  assert.equal(shop[7], 'shop:confectionery');
  assert.match(out.license, /ODbL/);
});

test('compact：鐵路路線不收；範圍用 0.5%～99.5% 的點，離島仍收錄', async () => {
  const pts = Array.from({ length: 400 }, (_, i) => E({ name: '店' + i, amenity: 'restaurant' }, 34.6 + (i % 20) * 0.01, 135.4 + Math.floor(i / 20) * 0.01));
  const out = await compact({ id: 'o', name: '東京都', country: 'jp' }, [...pts,
    { type: 'relation', center: { lat: 34.2, lon: 132.96 }, tags: { name: '山陽新幹線', railway: 'station' } },
    E({ name: '小笠原的店', amenity: 'cafe' }, 27.09, 142.19)]);
  assert.equal(out.n, 401);
  assert.ok(out.bbox[0] > 34 && out.bbox[1] > 135);
  assert.ok(out.rows.some(r => r[0] === '小笠原的店'));
});

test('Overpass：伺服器逾時就換台，整塊太大就切四塊，結果不重複遺漏', async () => {
  process.env.POI_FAST = '1';
  const { fetchRegion, query, quarter, resetFails } = await import('../tools/build-poi.mjs');
  resetFails();
  const q = query('["name"="京都府"]', ['nwr["shop"~"^(a|b)$"]["name"]', 'nwr["railway"="station"]["name"]'], [34, 135, 35, 136]);
  assert.match(q, /nwr\["shop"~"\^\(a\|b\)\$"\]\["name"\]\(area\.a\)\(34/, 'regex 裡的 | 不能被拆開');
  assert.match(q, /\[timeout:180\]/);
  assert.doesNotMatch(q, /maxsize/);
  assert.match(q, /nwr\["railway"="station"\]\["name"\]\(area\.a\)\(34\.0000,135\.0000,35\.0000,136\.0000\);/);
  assert.deepEqual(quarter([0, 0, 2, 2]), [[0, 0, 1, 1], [0, 1, 1, 2], [1, 0, 2, 1], [1, 1, 2, 2]]);
  const hosts = [];
  const fake = async (u, o) => {
    hosts.push(new URL(u).host);
    const d = decodeURIComponent(o.body.slice(5));
    const bb = d.match(/\(area\.a\)\(([^)]+)\)/)[1].split(',').map(Number);
    if (bb[2] - bb[0] > 1.5) return { ok: false, status: 504 };   // 整縣：逾時
    if (hosts.length % 4 === 0) return { ok: true, json: async () => ({ elements: [], remark: 'runtime error: Query timed out' }) }; // 偶爾回不完整
    return { ok: true, json: async () => ({ elements: [{ type: 'node', id: Math.round(bb[0] * 10 + bb[1]), lat: bb[0], lon: bb[1], tags: { name: 'x' } }] }) };
  };
  const els = await fetchRegion('["name"="X"]', [0, 0, 2, 2], fake);
  assert.ok(new Set(hosts).size === 3, '三台都有用到');
  // 三類 × 四塊（被回不完整的那幾塊會再切小）——每類至少覆蓋四個象限
  for (const [la, lo] of [[0, 0], [0, 1], [1, 0], [1, 1]]) assert.ok(els.some(e => Math.floor(e.lat) === la && Math.floor(e.lon) === lo));
});

test('自然景點：湖、瀑布、島、國立公園歸「自然」，細類保留', async () => {
  const { compact, queries } = await import('../tools/build-poi.mjs');
  assert.equal(catOf({ natural: 'water', water: 'lake' }), 'nature');
  assert.equal(catOf({ waterway: 'waterfall' }), 'nature');
  assert.equal(catOf({ place: 'island' }), 'nature');
  const q = queries('["name"="青森県"]');
  assert.equal(q.length, 4);
  assert.match(q[3], /natural"~"\^\(water\|waterfall\|peak.*\["wikidata"\]\(area\.a\)/);
  const out = await compact({ id: 't', name: 'T', country: 'jp' }, [E({ name: '十和田湖', natural: 'water', wikidata: 'Q1' }, 40.46, 140.88, 'relation')]);
  assert.equal(out.rows[0][6], 'nature'); assert.equal(out.rows[0][7], 'water');
});

test('電話與網站：取第一個，網址要是 http(s)', async () => {
  const out = await compact({ id: 't', name: 'T', country: 'jp' }, [
    E({ name: '一蘭', amenity: 'restaurant', phone: '+81 75-1234-5678;+81 75-0000-0000', website: 'https://ichiran.com/' }),
    E({ name: '店B', shop: 'books', 'contact:phone': '075-111-2222', website: 'ichiran.com' }, 35.01),
  ]);
  const a = out.rows.find(r => r[0] === '一蘭'), b = out.rows.find(r => r[0] === '店B');
  assert.equal(a[13], '+81 75-1234-5678'); assert.equal(a[14], 'https://ichiran.com/');
  assert.equal(b[13], '075-111-2222'); assert.equal(b.length, 14, '不合格的網址不收，尾端空欄位省略');
  assert.deepEqual(out.cols.slice(-2), ['phone', 'web']);
});
