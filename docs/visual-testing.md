# 設計展示與視覺回歸

開發伺服器上的 /design-preview 使用固定示範資料與實際 ScoreValue、PairScoreValue、SuitSymbol、CommentText 元件，以及牌桌的共用樣式。頁面不讀寫資料庫。正式環境預設回傳 404；只有明確設定 DESIGN_PREVIEW=1 才開放。

## 分數格式

- lib/score-format.ts：scoreParts、formatScore、pairScoreFormat 負責顯示精度、正負號、缺值與單位，不介入計分。
- components/score-value.tsx：ScoreValue 為通用數值，PairScoreValue 處理 MP 百分率及 Butler／CrossIMP。使用數值參數，不先自行 toFixed 或拼接單位。
- unit 指定 %、IMP、MP、VP；沒有資料不顯示單位。showUnit=false 用於明細已有單位上下文的情況。
- decimals 預設 2，Butler 單副值及最大分差為 0。compact 預設 true；純文字用途用 formatScore。
- 總排名、雙人賽逐副／搭檔表格、K 棒、Butler 浮動統計已採共用格式。scoreboard-shared 的 number／pairValue 是舊介面的相容入口，也轉交共用函式。

## 執行

1. npm ci
2. npx playwright install chromium
3. npm run test:visual

測試啟動 3107 port 與 .next-visual 獨立建置目錄，涵蓋五主題、390px 手機與 1440px 桌面；檢查橫向溢出、展開明細及截圖差異。這是 Chromium 手機尺寸測試，不代表 iPhone Safari 實機已驗證。

基準置於 tests/visual/baselines。只有確認改版符合設計規則後才執行 npm run test:visual:update，檢閱變更圖像再提交。固定作業系統、瀏覽器版本與字型才能比較；目前基準產生於 Windows。Linux CI 不應直接覆寫 Windows 基準。

新共用元件或缺值案例要加入展示頁；測試不應使用正式賽事或動態日期。
