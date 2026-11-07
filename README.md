# 旅冊｜旅遊小冊製作器

把旅行行程排成可以列印、可以傳給旅伴的旅遊小冊。免安裝、免註冊。

- 資料只存在使用者自己的瀏覽器（IndexedDB），不會上傳到任何伺服器。換裝置請用「匯出 → 下載備份檔」。
- 可以加到手機主畫面（PWA），離線也能打開。
- 匯出：A5 列印／PDF、A4 對折小冊（騎馬釘）、可傳給旅伴的 HTML 小冊、送禮版、行事曆 .ics。

## 檔案

- `index.html`：整個 app（單一檔案）
- `manifest.webmanifest`、`sw.js`、`icons/`：加到主畫面與離線使用
- `worker.js`、`wrangler.toml`、`.assetsignore`：Cloudflare Worker。靜態檔案照常由 Workers Static Assets 提供，另外多一個 `/api/gmaps-list`（見下）

`index.html` 走「先連網、失敗才用快取」，所以有網路時使用者打開就會拿到新版，不用改 `sw.js`。只有改了圖示或 `manifest.webmanifest` 時，才需要把 `sw.js` 裡的 `VERSION` 加一號，讓舊的快取被清掉。

## 從 Google 地圖「儲存清單」匯入景點（需要 Worker）

景點分頁可以貼上 Google 地圖清單的分享連結（`maps.app.goo.gl/…`），一次把清單裡的地點勾選匯入（名稱、地址、座標、清單備註）。

瀏覽器做不到這件事：清單頁是 JS 動態載入，Google 的清單 API（`/maps/preview/entitylist/getlist`）沒有 CORS 標頭，短網址的轉址也看不到。所以由 `worker.js` 代讀：解短網址 → 取清單 id（`!2s…` 或 `/placelists/list/…`）→ 呼叫 getlist → 回傳精簡 JSON（含 `Access-Control-Allow-Origin: *`，資料本來就是公開分享的清單）。Worker 只接受 Google 地圖的網址，不是通用代理。

部署：`npx wrangler deploy`（會同時上傳靜態檔案與 Worker）。app 預設打 `https://travel-book.jim99725.workers.dev/api/gmaps-list`；自架的人可在瀏覽器 console 設 `localStorage.setItem('tabisatsu.gmproxy','https://你的.workers.dev/api/gmaps-list')`。

方法三（電腦、最穩）：景點分頁有一個可拖到書籤列的「匯入旅冊」書籤小工具。它在 Google 地圖清單頁執行，因為跟 Google 同源所以沒有 CORS 問題、也不經過任何伺服器；抓到清單後帶著 `#gm=<base64 JSON>` 開啟旅冊，旅冊啟動時看到 `#gm=` 就跳出勾選框（資料不會留在網址列，讀完就清掉）。

沒有 Worker（GitHub Pages、離線）時的方法二：電腦版 Google 地圖打開清單，在清單欄 Ctrl+A 全選、複製，貼到同一個框，只會得到名稱與類別。

已知限制：一次最多讀 500 個（`!4i500`）。Google 對 Cloudflare 機房 IP 會回 429（實測 2026-11 如此），Worker 會依序換 `www.google.com`、`maps.google.com`、`www.google.com.tw`、`www.google.co.jp` 再試；全被擋時 app 會提示改用方法三或方法二。`/api/gmaps-list?u=…&debug=1` 會多回 `via`（成功的主機）與 `tried`。

## 授權與致謝

- QR code 產生：[qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)（Kazuhiko Arase，MIT License）。"QR Code" 是 DENSO WAVE INCORPORATED 的註冊商標。
- 匯出圖片時才會從 cdnjs 載入：[html2canvas](https://github.com/niklasvh/html2canvas)（MIT License）、[JSZip](https://github.com/Stuk/jszip)（MIT 或 GPLv3 雙授權，這裡採 MIT）。
- 字型：Google Fonts 的 Noto Sans TC / Noto Serif TC（SIL Open Font License）。
- 插圖與介面：旅冊自製。

## 美術素材（design-v1）

介面素材放在 `assets/travel-book/`（來源說明見該資料夾的 `README.md`）。

- 介面顏色由 `assets/travel-book/style-tokens.css` 的 `--tb-*` 變數提供，`index.html` 的 `--ui-*` 對應到這些變數；小冊列印頁（`#bkcss`）不使用這些變數。
- `brand/logo-horizontal-clear.*` 是從 `logo-horizontal` 裁掉底部色塊、去背後的版本。
- `icons/` 由 `app-icon-1024` 裁成滿版正方形後產生；maskable 版本把圖縮到 82% 並以模糊底圖補邊。
- 素材原始插畫為 AI 產生後拆分，放大不等於提高印刷解析度。

## 資料版本（schema）

每份行程都存有 `schema` 版本號（目前是 2）。要改資料結構時：

1. 把 `index.html` 裡的 `SCHEMA` 加一。
2. 在 `MIGRATE` 加一個步驟，鍵是「從哪一版升上來」，例如 `2:t=>{ /* 把舊欄位改成新欄位 */ }`。
3. 新欄位的預設值寫在 `normalize()`。

讀取或匯入時會依序跑完升級步驟。如果瀏覽器裡有比程式還新的資料（例如舊的快取頁面打開了新版存的資料），程式會暫停儲存並提示重新整理，避免蓋掉資料。

## 小冊範本

範本設定集中在 `TEMPLATES`（名稱、紙色、封面選項，以及載圖、裝飾等掛鉤），CSS 寫在 `#bkcss` 裡的 `.bk.tpl-<id>` 底下。新增範本時加一筆設定、寫對應的 CSS 即可。
