# 手機性能逐項改善

2026-10-25。起始正式版本 `6e2e9a2`；僅依序實作、驗證、正常推送與核對既有 Vercel 自動部署，不混合多項改動，不以單次 PSI 分數保證收益。

## 1. 字型宣告去重

將 Noto Sans TC、DM Sans、Source Serif 4 的 Google Fonts 請求改為 `wght@400..700`，取代逐一列出字重。字型家族、原有字重、fallback、display=swap 與非阻塞載入方式保持不變；沒有裁字或新增依賴。

實際擷取兩種 API 回應（同 Chrome UA、同一時段）比較：CSS UTF-8 未壓縮大小 512623 → 132619 bytes，font-face 469 → 127。每個家族的 unicode-range 集合與全部字型檔 URL 完全相同，包括 Noto Sans TC 的 108 個 Unicode 分片；原本只是相同分片與檔案隨每個字重重複宣告。因此這項減少的是字型樣式傳輸／解析，不宣稱字型二進位下載量也等比例下降，完整原有繁中字元覆蓋保留。

驗證：完整測試 353 pass／0 fail／0 skipped；typecheck、production build 通過；手機／桌面五主題截圖及慢字型回歸 12 pass，未更新視覺基準。原始回應與檢查紀錄保存在本機忽略目錄 `.tmp/font-{current,variable}.css`、`.tmp/probe-fonts.mjs`、`.tmp/stage1-*.log`。

正式 PSI 指標應於該提交部署 READY、正式 alias 與頁面 SHA 核對後記錄；capture 相同的報告不算獨立樣本。未完成 iPhone Safari 實機驗證。

部署 `fe8c8e5a0855b14ec76fad6a97e7829e0aba2205`／`dpl_DxTVdWDumApChUHsoz6cUvLz1XGW` 已 READY 並核對正式 alias、首頁版本。官方 PSI `vspkrperai`（2026-10-25 02:00:15 UTC；capture 02:00 UTC，Lighthouse 13.5.0）：手機 65，FCP/LCP/SI 4817/6317/4817 ms、TBT 0、CLS .009；桌面 100，461/676/763 ms、TBT 9、CLS .002。未使用 CSS 估計由 159 降至 57 KiB，與宣告去重符合；單次手機分數低於上一個獨立樣本 83，不能宣稱穩定升分或僅憑分數認定回歸。CrUX 無資料；詳細 UI 與 calculator 觀察在 `.tmp/incremental-performance/psi-observations.json`。

## 2. 首頁／成績功能分包

原本 page 同時靜態匯入 CompetitionHub 與 Scoreboard；本機 production manifest 顯示二者共用四個入口 chunks，合計 734517 bytes（未壓縮，非完整網路總量）。加入 client 邊界的 dynamic Scoreboard，保留既有 query 深連結與 SSR；成績中的 AdminPanel、BoardsView 亦依分頁載入，不改權限或業務處理。

新首頁入口三個 chunks 合計 66601 bytes；production 真實首頁 script 回應檢查未包含 event mutation／board discussion 實作標記。此檢查不等同證明全部非必要程式均已移除。新增固定資料、無寫入的深連結→逐副→排名回歸，並對 production 在手機／桌面驗證。

完整測試 353 pass；typecheck、production build 通過。既有五主題基準不更新；新增導航測試初次因測試 selector 誤用 standings-table 失敗，改為既有 ranking-table 後，production 導航與慢字型 4 pass。全部視覺／導航最終結果記於 `.tmp/stage2-visual-final.log`。

最終視覺／導航 14 pass。部署 `a829422d2ebdd51809732b34f7a9eb94e323f5f3`／`dpl_BSQULfTxP7H11VQwd5z3JCfcJKqh` 已 READY，正式 alias 與頁面版本相符。PSI `6rywg4diht`（02:05:43 UTC、capture 02:05 UTC、Lighthouse 13.5.0）：手機 69，FCP/LCP/SI 4815/5115/4815 ms、TBT 0、CLS 0；桌面 100，453/524/759 ms、TBT 3、CLS 0。未使用 JS 估計 235 → 52 KiB，符合分包方向；單次分數不是獨立多次中位數，CrUX 無資料。

## 3. 非首頁樣式：保留現狀

分包後仍只有約 150 ms 的阻塞 CSS 估計收益。全域 styles 的牌桌／主題覆寫依賴明確 cascade 順序，延後 vendor CSS 可能反過來覆蓋主題。本輪優先保持已通過的五主題／手機／桌面結果，不為這項小額估計收益拆動 cascade，不移除功能樣式；它仍是可日後單獨評估的範圍，不聲稱已解決全部未使用 CSS。

## 4. 清單不等待 session

兩個原本就平行的 GET 現在各自套用回應：賽事摘要成功時先顯示清單，session 回來後才更新管理控制項。初始仍為非管理者；不改任何 API、Cookie、查詢快取、封存過濾或伺服器權限，清單始終使用伺服器已授權的 `/api/competitions` 回應。`load` 仍等待兩者供登入／操作後刷新流程使用，錯誤仍走既有處理。

新增匿名／裁判兩種 session 延遲回歸：session 尚未回應時清單已顯示、建立按鈕隱藏；回應後僅裁判顯示該按鈕。不把前端測試當成伺服器權限替代，既有完整權限／封存測試仍須通過。本項主要改善清單可用時間；先前 LCP 是頁尾，故不保證特定 LCP 或分數收益。

驗證：完整測試 353 pass；typecheck、production build 通過；五主題／手機／桌面與所有回歸共 18 pass；同一 production build 的 session、導航及慢字型回歸另 8 pass。沒有更新既有截圖基準；紀錄在 `.tmp/stage4-*.log`。最終部署與 PSI 原始觀察保留在 `.tmp/incremental-performance/`，需按精確 SHA 核對，不能把前一階段結果當成本階段結果。
