// node --test test/   —— 用固定的 Google getlist 回應片段驗證 worker.js 的解析器，Google 改格式時這裡會先紅
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseList, LIST_RE } from '../worker.js';

// 2026-11 實際回應的結構（已把個人備註與頭像網址換成假資料）
const FIX = [[["NxV8zQJUGQho9N09FWXhjb9mVh0-Qg",3,[[1],[9]],1,1],4,[2,1,"https://www.google.com/maps/placelists/list/NxV8zQJUGQho9N09FWXhjb9mVh0-Qg"],["Ember","https://lh3.googleusercontent.com/a/x","1"],"Want to go","",null,null,
  [[null,[null,null,"406臺中市北屯區仁美里昌平路二段50-6巷27號崇德薈社區店面薈咖啡 毛線 編織1樓",null,"406臺中市北屯區仁美里昌平路二段50-6巷27號崇德薈社區店面1樓",[null,null,24.1922666,120.6833968],["3776575324979242805","5608655057997493887"],"/g/11m5y1p8mp"],"薈咖啡 毛線 編織","",null,null,null,[],[[1],["a","b"]],[1,2],[1,2],null,["Ember","x","1"]],
   [null,[null,null,"403台中市西區公正路133號發愣吃VARMT 勤美店",null,"403台中市西區公正路133號",[null,null,24.1488711,120.6619371],["3776617093466622581","-3638401847299425796"],"/g/11mvgngt67"],"發愣吃VARMT 勤美店","週一公休",null,null,null,[],[[1],["a","b"]],[1,2],[1,2],null,["Ember","x","1"]],
   [null,[null,null,"",null,"",[null,null,35.0,135.7],["1","2"],"/g/x"],"","",null]],
  [],[1705292799,967494000],[1794089005,902450000],339]];

test('parseList：名稱、乾淨地址、座標、備註、CID 連結', () => {
  const r = parseList(JSON.parse(JSON.stringify(FIX)));
  assert.equal(r.title, 'Want to go');
  assert.equal(r.owner, 'Ember');
  assert.equal(r.total, 339);
  assert.equal(r.places.length, 2, '沒有名稱的項目要被濾掉');
  const [a, b] = r.places;
  assert.equal(a.name, '薈咖啡 毛線 編織');
  assert.equal(a.address, '406臺中市北屯區仁美里昌平路二段50-6巷27號崇德薈社區店面1樓', '要用 p[4]（不含店名）');
  assert.equal(a.lat, 24.1922666); assert.equal(a.lng, 120.6833968);
  assert.equal(a.mapUrl, 'https://www.google.com/maps?cid=5608655057997493887');
  assert.equal(b.note, '週一公休');
  assert.equal(b.mapUrl, 'https://www.google.com/maps?cid=14808342226410125820', '負數 id 要轉成無號 64 位元');
});

test('parseList：結構不對時回 null（不是丟例外）', () => {
  assert.equal(parseList(null), null);
  assert.equal(parseList([[1, 2, 3]]), null);
  assert.equal(parseList([["x", 1, 2, 3, "title", "", null, null, "not-an-array"]]), null);
});

test('LIST_RE：三種清單網址都能取出 id', () => {
  const id = 'NxV8zQJUGQho9N09FWXhjb9mVh0-Qg';
  for (const u of [
    `https://www.google.com/maps/@/data=!3m1!4b1!4m3!11m2!2s${id}!3e2?entry=tts`,
    `https://www.google.com/maps/placelists/list/${id}`,
    `https://www.google.com/maps/@24.18,120.62,11z/data=!4m3!11m2!2s${id}!3e2`,
  ]) assert.equal((u.match(LIST_RE) || [])[1], id, u);
  assert.equal('https://www.google.com/maps/place/Foo/data=!4m2!3m1!1s0x123:0x456'.match(LIST_RE), null, '一般地點網址不該被當成清單');
});
