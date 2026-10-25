# 手機性能逐項改善

2026-10-25。起始正式版本 `6e2e9a2`；僅依序實作、驗證、正常推送與核對既有 Vercel 自動部署，不混合多項改動，不以單次 PSI 分數保證收益。

## 1. 字型宣告去重

將 Noto Sans TC、DM Sans、Source Serif 4 的 Google Fonts 請求改為 `wght@400..700`，取代逐一列出字重。字型家族、原有字重、fallback、display=swap 與非阻塞載入方式保持不變；沒有裁字或新增依賴。

實際擷取兩種 API 回應（同 Chrome UA、同一時段）比較：CSS UTF-8 未壓縮大小 512623 → 132619 bytes，font-face 469 → 127。每個家族的 unicode-range 集合與全部字型檔 URL 完全相同，包括 Noto Sans TC 的 108 個 Unicode 分片；原本只是相同分片與檔案隨每個字重重複宣告。因此這項減少的是字型樣式傳輸／解析，不宣稱字型二進位下載量也等比例下降，完整原有繁中字元覆蓋保留。

驗證：完整測試 353 pass／0 fail／0 skipped；typecheck、production build 通過；手機／桌面五主題截圖及慢字型回歸 12 pass，未更新視覺基準。原始回應與檢查紀錄保存在本機忽略目錄 `.tmp/font-{current,variable}.css`、`.tmp/probe-fonts.mjs`、`.tmp/stage1-*.log`。

正式 PSI 指標應於該提交部署 READY、正式 alias 與頁面 SHA 核對後記錄；capture 相同的報告不算獨立樣本。未完成 iPhone Safari 實機驗證。
