# 首屏字型載入驗證

2026-10-25；修改前基準 `380f07e`。範圍為未登入首頁的 Google Fonts／站內 CSS 阻塞，不改字型設計、功能或正式服務設定。

## 原因與修改

`app/styles/foundation.css` 原本以兩個 Google Fonts `@import` 開頭。站內 CSS 下載後才發現外站樣式，而字型樣式回應也阻塞渲染；`display=swap` 只控制字型檔的呈現，不解除這層 CSS 依賴。

將完全相同的兩個 URL 移到 `app/layout.tsx`：head 預連線／預載 CSS，`next/script` 的 afterInteractive 階段附加 stylesheet。初始內容可以先用既有 fallback 字型顯示，字型樣式到達後套用原本的字型與字重；noscript 保留一般 stylesheet fallback。沒有移除六種字型、字重或修改花色與主題，沒有新增依賴。

站內 CSS 的 cascade 順序保持原樣；仍是一般阻塞樣式。本輪沒有把所有站內 CSS 非同步化，也沒有聲稱解決全部未使用 CSS／JS。拆分共用與 Viewer 樣式會涉及更多頁面與覆寫關係，不在此最小修正中處理。手冊的獨立字型樣式也不在本次首頁範圍。

## 同條件 production 控制實驗

既有 Playwright Chromium，Windows／Node 23.4.0、Next.js 16.4.3；相同 loopback `127.0.0.1:3110`、demo 資料、DPR 1，手機 390×844、桌面 1440×1000。每組三次全新 context，無 CPU／網路節流；兩份 Google Fonts CSS 均由 route 固定延遲 2500 ms 後回傳相同空 CSS，以隔離「字型樣式回應慢」的阻塞效果。這不是實際字型傳輸測量或 Lighthouse。

| 中位數 | 修改前 FCP／LCP | 修改後 FCP／LCP | 修改前／後 CLS |
| --- | --- | --- | --- |
| 手機 | 2620／2620 ms | 96／96 ms | 0.009018／0.009018 |
| 桌面 | 2640／2640 ms | 112／112 ms | 0.001651／0.001651 |

瀏覽器 Resource Timing 的字型 CSS `renderBlockingStatus` 由 blocking 變為 non-blocking；修改後在這兩份回應完成前已出現首屏。資料保存在本機忽略目錄 `.tmp/font-performance/{before,after}/results.json`，測量腳本在 `.tmp/font-performance.mjs`。數字不能外推為正式站提升幅度。

## 字型與畫面驗證

- 實際 Google Fonts 網路回應另作核對：兩種尺寸皆有載入 DM Sans／Noto Sans TC，桌面另有 Libertinus Serif；前後均註冊 470 個 font faces。首頁完成字型載入後，手機與桌面截圖前後檔案內容完全一致，無橫向溢出或 pageerror。
- 修改後另一次真實網路觀察：手機 CLS 0.009162、桌面 0.001874；僅單次、不是與基準等條件的量測，不與 PSI 比較。初始 fallback 後 swap 是預期行為，慢字型連線仍可能產生短暫字型變換。
- 關閉 JavaScript 時兩份 noscript 字型 stylesheet 均成功註冊。
- `npm run test:visual`：12 passed，包含五主題×桌面／手機的既有截圖、花色與溢出檢查，以及慢字型首次繪製回歸；未更新基準。截圖測試增加等待非同步字型 stylesheet 註冊，再等 `document.fonts.ready`，避免只拍到 fallback。
- 新回歸 `tests/visual/font-loading.spec.ts` 將兩份字型 CSS 暫扣，確認兩個請求已發出時，首頁標題與 FCP 已可見，再釋放回應；沒有移除字型以換取通過。
- 最終加強版回歸另直接對相同 production server 執行：手機／桌面 2 passed（2.3 秒）；設定在本機 `.tmp/playwright-font.config.ts`，完整輸出 `.tmp/font-production-regression.log`。
- `npm test`：353 passed、0 failed／skipped；`npm run typecheck`、`npm run build` 通過，build 含手冊 15 HTML 頁與本機連結／資源核對。

## 限制與後續

來源 PSI 為 2026-10-25 01:27:35 UTC 的正式站單次測量：手機 62、桌面 92，手機 FCP 5442 ms／LCP 7242 ms，估計字型與 CSS 阻塞可省 5040 ms。那是 Lighthouse 13.5.0、正式服務與其模擬條件，不能與上述本機控制實驗作分數或時間的等條件比較。

本機沒有 Lighthouse 套件，未自行安裝；若需要同條件 Lighthouse 分數比較，需要另行允許安裝／使用指定版本的工具。未作 iPhone Safari 實機驗證、CrUX／INP、正式資料與登入流程測試。既有字型名稱、Unicode 花色與 CSS 未更動，不代表已完成 iOS 實機驗收。

尚未 push 或部署；正式站仍是舊版本。經使用者授權部署後，再以相同 PSI 條件多次重測，才可判斷正式環境收益；不要保證分數達到特定門檻。
