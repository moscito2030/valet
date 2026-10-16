# @valet/deal-viewer

Valet 與 Valet Review 共用的 React 牌局檢視器。唯一維護來源為 Valet 倉庫的 `packages/deal-viewer/`。
包含四家手牌、單家視角、試打規則、花色鍵盤輸入、DDS worker 與牌桌樣式。資料型別只要求檢視器需要的欄位，不依賴賽務資料庫。

## 使用

從 `@valet/deal-viewer` 匯入 `DealExplorer` / `BoardInformation`，並載入 `@valet/deal-viewer/style.css`。React 19 與 lucide-react 為 peer dependencies。
Next.js 主程式設定 `transpilePackages`；Vite 可直接編譯。應用程式的 prepare-dds 腳本將套件 worker 複製到 public/dds-worker.js，並準備 bridge-dds 引擎。

單家視角與四手牌均保留原始手牌順序；已出牌加上 played-card 並停用，合法出牌只由 PlayState 決定。隱藏對手與首攻後亮夢家的規則不變。

## 更新兩個專案

1. 僅修改此目錄的元件、核心邏輯、worker 或樣式；勿修改 Review 的 node_modules。
2. 提升此 package.json 版本，於 Valet 執行 npm install --offline --ignore-scripts 更新鎖定檔。
3. 執行 npm run viewer:sync -- ../valet-review，將同一份套件打包並更新 Review 的本機依賴。
4. 兩個專案各自執行 npm test 與 npm run build，並驗證瀏覽器試打。
5. 分別提交 Valet 原始碼及 Review 的 vendor 套件、package.json、package-lock.json。推送由使用者決定。

Review 攜帶版本固定的 vendor/*.tgz，不需要旁邊存在 Valet，也不需要私人 npm registry。此流程是明確升版，不會在部署時偷偷拉取另一個倉庫的最新版本。
