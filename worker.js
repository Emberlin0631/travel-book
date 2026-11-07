/* 旅冊 Cloudflare Worker
 * 1. 靜態檔案（index.html、assets/…）交給 Workers Static Assets（wrangler.toml 的 [assets]）。
 * 2. GET /api/gmaps-list?u=<Google 地圖清單分享連結>
 *    瀏覽器抓不到 Google 清單（頁面是 JS 動態載入、清單 API 沒有 CORS），
 *    所以由這支 Worker 代讀：解短網址 → 取清單 id → 呼叫 getlist → 回傳精簡 JSON。
 *    只接受 Google 地圖的網址，不會代理其他網站。
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const LIST_RE = /(?:!2s|\/placelists\/list\/|[?&]list=)([A-Za-z0-9_-]{16,})/;
const GM_HOST = /^(maps\.app\.goo\.gl|goo\.gl|(www\.)?google\.[a-z.]{2,6}|maps\.google\.[a-z.]{2,6})$/i;
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET', 'access-control-max-age': '86400' };

const json = (o, status = 200, extra = {}) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...CORS, ...extra } });

async function listIdFrom(raw) {
  let u;
  try { u = new URL(raw); } catch (e) { return null; }
  if (!GM_HOST.test(u.hostname)) return null;
  let m = raw.match(LIST_RE);
  if (m) return m[1];
  // 短網址：最多跟 4 次轉址，只看 Location，不下載頁面
  let cur = u.href;
  for (let i = 0; i < 4; i++) {
    const r = await fetch(cur, { redirect: 'manual', headers: { 'user-agent': UA, 'accept-language': 'zh-TW,zh;q=0.9' } });
    const loc = r.headers.get('location');
    if (!loc) break;
    cur = new URL(loc, cur).href;
    m = cur.match(LIST_RE);
    if (m) return m[1];
    if (/consent\.google\./.test(cur)) throw new Error('blocked');
  }
  return null;
}

function parseList(j) {
  const L = j && j[0];
  if (!L || !Array.isArray(L[8])) return null;
  const places = L[8].map(it => {
    const p = Array.isArray(it[1]) ? it[1] : [];
    const ll = Array.isArray(p[5]) ? p[5] : [];   // [null,null,lat,lng]
    const ids = Array.isArray(p[6]) ? p[6] : [];  // [featureId, cid]（有號 64 位元十進位字串）
    let cid = '';
    try { if (ids.length > 1) cid = BigInt.asUintN(64, BigInt(ids[1])).toString(); } catch (e) {}
    return {
      name: String(it[2] || '').trim(),
      address: String(p[4] || p[2] || '').trim(), // p[4] 是乾淨地址，p[2] 後面會黏著店名
      lat: typeof ll[2] === 'number' ? ll[2] : null,
      lng: typeof ll[3] === 'number' ? ll[3] : null,
      note: String(it[3] || '').trim(),
      mapUrl: cid ? 'https://www.google.com/maps?cid=' + cid : ''
    };
  }).filter(x => x.name);
  return { title: String(L[4] || ''), owner: (L[3] && L[3][0]) || '', total: +L[12] || places.length, places };
}

async function gmapsList(url) {
  const raw = url.searchParams.get('u') || '';
  let id;
  try { id = await listIdFrom(raw); } catch (e) { return json({ error: e.message === 'blocked' ? 'blocked' : 'upstream' }, 502); }
  if (!id) return json({ error: 'notlist' }, 400);
  const pb = `!1m6!1s${id}!2e3!3m1!1e1!3m1!1e9!2e2!3e2!4i500`;
  // Google 對資料中心 IP 常回 429；換幾個主機依序試，哪個通就用哪個
  const hosts = ['www.google.com', 'maps.google.com', 'www.google.com.tw', 'www.google.co.jp'];
  const tried = [];
  for (const h of hosts) {
    const api = `https://${h}/maps/preview/entitylist/getlist?authuser=0&hl=zh-TW&gl=tw&pb=${encodeURIComponent(pb)}`;
    let r;
    try {
      r = await fetch(api, { headers: {
        'user-agent': UA, 'accept': '*/*', 'accept-language': 'zh-TW,zh;q=0.9,en;q=0.8',
        'referer': `https://${h}/maps/`, 'origin': `https://${h}`, 'x-same-domain': '1',
        'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty',
        'sec-ch-ua': '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"', 'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"Windows"'
      } });
    } catch (e) { tried.push(h + ':fetch-failed'); continue; }
    if (!r.ok) { tried.push(h + ':' + r.status); if (r.status !== 429 && r.status !== 403 && r.status !== 503) break; continue; }
    const txt = (await r.text()).replace(/^\)\]\}'\n?/, '');
    let data;
    try { data = parseList(JSON.parse(txt)); } catch (e) { tried.push(h + ':badjson'); continue; }
    if (!data) return json({ error: 'notlist' }, 400);
    if (url.searchParams.get('debug')) data.via = h, data.tried = tried;
    return json(data, 200, { 'cache-control': 'public, max-age=300' });
  }
  return json({ error: tried.some(t => /:(429|403|503)$/.test(t)) ? 'blocked' : 'upstream', tried }, 502);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/api/gmaps-list') {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      if (req.method !== 'GET') return json({ error: 'method' }, 405);
      return gmapsList(url);
    }
    if (env.ASSETS) return env.ASSETS.fetch(req);
    return new Response('not found', { status: 404 });
  }
};
