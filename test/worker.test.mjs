// node --test test/   —— 驗證 worker.js 展開單一地點短網址後的解析
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeFromUrl } from '../worker.js';

test('placeFromUrl：/maps/place/ 與 ?q= 兩種展開後網址', () => {
  const a = placeFromUrl('https://www.google.com/maps/place/%E6%B8%85%E6%B0%B4%E5%AF%BA/@34.9948561,135.7850463,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d34.9948561!4d135.7850463');
  assert.equal(a.name, '清水寺'); assert.equal(a.lat, 34.9948561); assert.equal(a.lng, 135.7850463);
  const b = placeFromUrl('https://maps.google.com/maps?q=%E9%8C%A6%E5%B8%82%E5%A0%B4&ftid=0x6001089f2d0e5a7b:0x4c4b0a8b&entry=gps');
  assert.equal(b.name, '錦市場'); assert.equal(b.lat, undefined);
  const c = placeFromUrl('https://maps.google.com/maps?q=35.0036,135.7649');
  assert.equal(c.name, undefined); assert.equal(c.lat, 35.0036);
});
