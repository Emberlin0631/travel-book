// 檢查 index.html 的台灣俗稱表（POI_ALIAS）右邊的日文名，在地點庫（poi/*.json）裡找不找得到。
// 用法：在網站資料夾執行  node tools/check-alias.mjs
// 找不到的原因通常是：那個縣還沒建、OpenStreetMap 上名稱不同、或那個地點的類型沒被收錄。
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = await fs.readFile(path.join(ROOT, 'index.html'), 'utf8');
const m = html.match(/const POI_ALIAS=(\{[\s\S]*?\});/);
if (!m) { console.log('index.html 裡找不到 POI_ALIAS'); process.exit(1); }
const ALIAS = Function('return ' + m[1])();
const norm = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[\s・·･\-_'"’.,()（）]/g, '');

let index;
try { index = JSON.parse(await fs.readFile(path.join(ROOT, 'poi', 'index.json'), 'utf8')); }
catch (e) { console.log('還沒有 poi/index.json，先跑 node tools/build-poi.mjs'); process.exit(1); }
const names = [];
for (const r of index.regions) {
  const d = JSON.parse(await fs.readFile(path.join(ROOT, r.file), 'utf8'));
  for (const row of d.rows) names.push([norm(row[0]), norm(row[1]), norm(row[2]), norm(row[3]), row[0], row[7] || '', r.zh]);
}
console.log(`地點庫：${index.regions.length} 個縣、${names.length} 筆\n`);

const targets = new Map();
for (const [k, v] of Object.entries(ALIAS)) for (const t of v) (targets.get(t) || targets.set(t, []).get(t)).push(k);
let miss = 0;
for (const [t, keys] of targets) {
  const n = norm(t);
  const exact = names.filter(x => x.slice(0, 4).includes(n));
  const part = exact.length ? [] : names.filter(x => x.slice(0, 4).some(s => s.includes(n)));
  if (exact.length) console.log(`✔ ${t}（${keys.join('、')}）→ ${exact.slice(0, 3).map(x => `${x[4]}［${x[5]}・${x[6]}］`).join('；')}`);
  else if (part.length) console.log(`△ ${t}（${keys.join('、')}）只有名稱包含它的 ${part.length} 筆，例如 ${part.slice(0, 3).map(x => `${x[4]}［${x[5]}］`).join('；')}`);
  else { miss++; console.log(`✖ ${t}（${keys.join('、')}）找不到`); }
}
console.log(`\n${targets.size} 個名稱，${miss} 個完全找不到。`);
