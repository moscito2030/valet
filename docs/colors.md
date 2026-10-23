# 色彩變數

共用色票集中在 `public/theme-colors.css`，由 `app/styles/colors.css` 匯入，靜態手冊也載入同一份檔案。
提供生成式藝術（forest）、傷眼睛（light）、租屋補助（sepia）、知識藍（nord）、ドパガキ（dracula）。各位置的花色與身價政策見 [產品設計規則](design-rules.md)。

## 使用方式

- 頁面與卡片：`--page-bg`、`--surface-bg`、`--surface-soft`。
- 文字與框線：`--text-primary`、`--text-muted`、`--border-default`。
- 操作：`--action-primary`、`--action-primary-hover`、`--action-secondary`、`--text-on-action`、`--focus-ring`。
- 側欄：`--sidebar-*`。
- 比賽語意：`--team-home`、`--team-away`、`--score-positive`、`--score-negative`、`--suit-red`。
- 開關圓點使用 `--switch-thumb`，不要因為目前都是白色就使用卡片背景變數。

舊名稱 `--paper`、`--ink`、`--muted`、`--line`、`--accent`、`--forest`、`--white`、`--soft` 保留為相容別名。新增樣式優先使用上述用途名稱。

## 主題與偏好

使用 `:root[data-theme="nord"]` 等規則覆寫色票，portal 與浮動視窗繼承文件根節點的變數。按用途覆寫，不要把隊伍色、負分色、花色紅全部當成同一種強調色。

`public/theme.js` 在應用程式 hydration 前還原偏好，使用 `valet-theme` localStorage 鍵。未選擇時保持原色；system 模式在淺色裝置使用原色、深色裝置使用 Nord，並監聽系統變更。跨分頁透過 storage 事件同步；儲存被封鎖時仍可在目前頁面切換。

同一個 `valet-theme-picker` Web Component 在 Next 根 layout 與 mdBook 建置輸出使用，Shadow DOM 隔離兩套頁面樣式。原生 popover 提供外部點擊及 Escape 關閉，radio group 支援方向鍵、Home、End。選單不在列印時顯示。

舊樣式使用 `var(--theme-text, 原色)` 等語意 fallback 保留原色的細微差異；其他主題統一覆寫用途色。新增元件應直接使用色票變數。`viewer-theme.css` 僅轉接外部牌局檢視器的顏色，不修改套件或其版面；更新套件時需重新核對轉接樣式。`manual-theme.css` 轉接 mdBook 的變數。

Nord 與 Dracula 是針對網站的調整版，參考 [Nord 官方色票](https://www.nordtheme.com/docs/colors-and-palettes/) 與 [Dracula 官方規格](https://draculatheme.com/spec)。次要文字與分數色經對比測試調整，並非逐色照搬編輯器主題。

新增主題需更新色票與選單資料，並執行 `tests/theme.test.ts` 的儲存、系統偏好、跨分頁及文字對比測試；另外檢查手機、表單、牌局、浮動表格與手冊。

## 共用呈現規則

花色實心／空心由 `--suit-solid-display`、`--suit-outline-display` 與 `--suit-outline-*` 控制，主程式與外部牌桌共用同一組 CSS 類別。身價使用 `--seat-nonvul-*`／`--seat-vul-*` 區分底色、姓名文字、座位標記與標記文字，主題差異只在集中色票定義。`SuitSymbol` 統一加入文字呈現標記，並接受可存取名稱，外層不再重複宣告圖像角色。
