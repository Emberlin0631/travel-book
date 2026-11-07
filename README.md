# 旅冊｜旅遊小冊製作器

把旅行行程排成可以列印、可以傳給旅伴的旅遊小冊。免安裝、免註冊。

- 資料只存在使用者自己的瀏覽器（IndexedDB），不會上傳到任何伺服器。換裝置請用「匯出 → 下載備份檔」。
- 可以加到手機主畫面（PWA），離線也能打開。
- 匯出：A5 列印／PDF、A4 對折小冊（騎馬釘）、可傳給旅伴的 HTML 小冊、送禮版、行事曆 .ics。

## 檔案

- `index.html`：整個 app（單一檔案）
- `manifest.webmanifest`、`sw.js`、`icons/`：加到主畫面與離線使用

每次更新 `index.html` 後，記得把 `sw.js` 裡的 `VERSION` 加一號，使用者才會拿到新版。

## 授權與致謝

- QR code 產生：[qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)（Kazuhiko Arase，MIT License）。"QR Code" 是 DENSO WAVE INCORPORATED 的註冊商標。
- 匯出圖片時才會從 cdnjs 載入：[html2canvas](https://github.com/niklasvh/html2canvas)（MIT License）、[JSZip](https://github.com/Stuk/jszip)（MIT 或 GPLv3 雙授權，這裡採 MIT）。
- 字型：Google Fonts 的 Noto Sans TC / Noto Serif TC（SIL Open Font License）。
- 插圖與介面：旅冊自製。
