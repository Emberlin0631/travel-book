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
