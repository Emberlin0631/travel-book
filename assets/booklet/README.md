# 抹茶手帳小冊素材（v2）

來源：《旅冊｜抹茶手帳美術素材 v2》共 37 張 PNG，經過以下處理後轉成 WebP：

- 透明插圖：移除與主體不相連的小雜點和頂端殘留細線，再裁到實際內容範圍。
- `cat-*` 縮到最長邊 640px；`sec-*`、`season-*-corner` 縮到 420px。
- `season-*-bits` 依相連區塊拆成單個元素：`season-<季節>-bit<n>.webp`，每個最長邊 220px。
- `paper-tile` 縮成 512px；`cover-a/b/c` 縮成 1240×1759（約 213dpi＠A5）。
- 沒有使用 `hero-mobile.png`（首頁手機版仍用從桌面主視覺裁出的 `travel-book/hero/hero-mobile.webp`）。

程式只在使用「抹茶手帳」範本時才載入這些圖，並轉成 data URL 放進頁面，所以匯出的手機閱讀版、A4 對折、送禮版和圖片都不依賴這個資料夾。
