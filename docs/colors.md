# 色彩變數

共用色票集中在 `app/styles/colors.css`，目前只有既有的淺色主題。
本次抽取保持原色值，不新增主題切換或改變視覺設計。

## 使用方式

- 頁面與卡片：`--page-bg`、`--surface-bg`、`--surface-soft`。
- 文字與框線：`--text-primary`、`--text-muted`、`--border-default`。
- 操作：`--action-primary`、`--action-primary-hover`、`--action-secondary`、`--text-on-action`、`--focus-ring`。
- 側欄：`--sidebar-*`。
- 比賽語意：`--team-home`、`--team-away`、`--score-positive`、`--score-negative`、`--suit-red`。
- 開關圓點使用 `--switch-thumb`，不要因為目前都是白色就使用卡片背景變數。

舊名稱 `--paper`、`--ink`、`--muted`、`--line`、`--accent`、`--forest`、`--white`、`--soft` 保留為相容別名。新增樣式優先使用上述用途名稱。

## 後續主題

可用 `:root[data-theme="dark"]` 覆寫色票；主題屬性應設在文件根節點，使 portal 與浮動視窗也能繼承。按用途覆寫，不要把隊伍色、負分色、花色紅全部當成同一種強調色。

這是共用色彩基礎，還不是完整的深色模式。部分功能專用的淺底色、邊框、陰影、牌局檢視器與元件內嵌色碼尚未遷移。新增主題前需逐一按用途整理，檢查表格、表單、浮動視窗、花色與分數的對比，並補上偏好儲存及首次載入處理。不要只覆寫幾個核心變數就宣告全站支援深色。
