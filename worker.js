/* 旅冊 Cloudflare Worker
 * 1. 靜態檔案（index.html、assets/…）交給 Workers Static Assets（wrangler.toml 的 [assets]）。
 * 2. GET /api/gmaps-place?u=<單一地點分享短網址>：只讀轉址的 Location 標頭，展開 maps.app.goo.gl。
 *    （2026-11 起不再提供「儲存清單」代讀；清單改用書籤小工具、我的地圖 KML 或複製貼上，都在使用者瀏覽器裡處理。）
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const GM_HOST = /^(maps\.app\.goo\.gl|goo\.gl|(www\.)?google\.[a-z.]{2,6}|maps\.google\.[a-z.]{2,6})$/i;
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET', 'access-control-max-age': '86400' };

const json = (o, status = 200, extra = {}) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...CORS, ...extra } });

/* 3. GET /api/gmaps-place?u=<單一地點分享短網址>
 *    瀏覽器跟不了 maps.app.goo.gl 的轉址（沒有 CORS），由這裡只讀 Location 標頭展開成完整網址，
 *    再從完整網址取名稱、座標。每一跳都必須還是 Google 地圖網域，不下載頁面內容。 */
function placeFromUrl(raw) {
  const r = { url: raw };
  let u; try { u = new URL(raw); } catch (e) { return r; }
  const m = u.pathname.match(/\/maps\/place\/([^/@]+)/);
  const dec = s => { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch (e) { return s; } };
  if (m) r.name = dec(m[1]);
  else { const q = u.searchParams.get('q'); if (q && !/^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(q.trim())) r.name = q.trim(); }
  const c = raw.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || raw.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || (u.searchParams.get('q') || '').match(/^(-?\d+\.\d+),\s*(-?\d+\.\d+)$/);
  if (c) { r.lat = +c[1]; r.lng = +c[2]; }
  return r;
}
async function gmapsPlace(url) {
  const raw = url.searchParams.get('u') || '';
  let cur; try { cur = new URL(raw); } catch (e) { return json({ error: 'format' }, 400); }
  if (!GM_HOST.test(cur.hostname)) return json({ error: 'format' }, 400);
  try {
    for (let i = 0; i < 5; i++) {
      if (!/^(maps\.app\.goo\.gl|goo\.gl)$/i.test(cur.hostname) && /\/maps|[?&]q=|[?&]cid=/.test(cur.href)) break;
      const r = await fetch(cur.href, { redirect: 'manual', headers: { 'user-agent': UA, 'accept-language': 'zh-TW,zh;q=0.9' } });
      const loc = r.headers.get('location');
      if (!loc) break;
      const nx = new URL(loc, cur.href);
      if (/consent\.google\./.test(nx.hostname)) return json({ error: 'blocked' }, 502);
      if (!GM_HOST.test(nx.hostname)) break;
      cur = nx;
    }
  } catch (e) { return json({ error: 'upstream' }, 502); }
  return json(placeFromUrl(cur.href), 200, { 'cache-control': 'public, max-age=86400' });
}

export { placeFromUrl };

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/api/gmaps-place') {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      if (req.method !== 'GET') return json({ error: 'method' }, 405);
      return gmapsPlace(url);
    }
    if (env.ASSETS) return env.ASSETS.fetch(req);
    return new Response('not found', { status: 404 });
  }
};
