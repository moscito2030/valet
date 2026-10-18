# 賽事與賽段

- `/` 顯示賽事卡片與搜尋，包含尚未建立賽段的空賽事。
- `/?competition=<id>` 顯示共用名稱、前綴、地點、由賽段推導的日期範圍與賽段選擇。空賽事顯示「日期未定／尚未安排賽段」。
- `/?event=<id>&view=...` 保留既有賽段成績深連結。
- 裁判先建立賽事，再新增賽段。賽段各自保存名稱、日期區間、名單、隊制／雙人賽、計分法、賽程、牌型、成績、判罰、收分／發布與裝置設定，不跨段累計成績。
- 共用名稱、前綴、地點在賽事主頁修改；各賽段後台修改賽段名稱、日期與地點覆寫。`venueOverride` 缺省代表沿用共用地點，字串代表獨立地點（空字串代表尚未定），PATCH 傳 `null` 恢復繼承。
- `date`、選填 `endDate` 只屬於賽段。日期區間包含起訖日，結束不得早於開始。各圈時間預設使用開始日期；跨日圈次指定完整日期時間。首頁日曆不把賽段之間的空檔當作比賽日期。
- 任一賽段均可刪除。刪除最後一段保留空賽事；整場刪除須在首頁另外選「刪除比賽」，確認完整名稱與最新版本。

## 儲存與相容性

同一 `bridge_events` 表儲存兩種獨立 JSON 文件；不需額外資料表或手動 migration。

| 文件 | 儲存鍵 | 內容 |
| --- | --- | --- |
| 賽事 | `competition:<id>` | `competition` 共用資訊、獨立 revision、操作紀錄、冪等 request IDs |
| 賽段 | 原 event ID | `event` 原始資料、projection、requests |

新賽段的 `parentEventId` 指向賽事 ID；原第一賽段沒有此欄位時，以自身 ID 找賽事。賽事 ID 與原第一賽段 ID 可以相同，但儲存鍵不同。新增、刪除或改名均不重新編號其餘賽段，保留成績網址與收分連結。

舊資料在尚無獨立賽事文件時，讀取以原根賽段的共用欄位作相容來源；第一次修改共用資訊、新增或刪除賽段時原子分離。保留的原根賽段 revision 在分離時加一，阻擋舊版本併發寫入，其原始成績、牌型、projection 與裝置憑證不變。後續共用資訊修改不再更動任何賽段 revision。`getEvent` 動態解析共用資訊及地點，衍生的 `event.competition` 不寫回原始文件。

local 使用儲存鎖與整檔原子替換；Neon 的賽段增刪／共用修改以一個 SQL CTE、共用文件 revision 檢查與 row lock 執行。整場刪除要求精確的賽事及各賽段 revision，並在同一 SQL 中重新鎖定與比對整個集合，避免漏刪新賽段或誤刪更新後資料。

## API

- `GET /api/competitions`：公開安全的賽事及賽段摘要，包含空賽事。
- `POST /api/competitions`：裁判建立空賽事，接受 `name`、選填 `prefix`、`venue`。
- `PATCH /api/competitions/[id]`：裁判修改共用欄位，附 `revision`、`requestId`。
- `POST /api/competitions/[id]/stages`：裁判新增賽段，附賽事 revision；禁止巢狀賽段。
- `DELETE /api/admin/events/[id]`：刪除單一賽段，保留賽事。
- `DELETE /api/admin/competitions`：連同所有賽段刪除選定賽事；空賽事的 `stages` 是空陣列。
- 舊 `POST /api/events` 仍可一次建立共用資訊與第一賽段，儲存時已分成兩份文件。

## 驗證

- `npm test`：獨立紀錄、空清單、資料相容、地點覆寫／清除、角色限制、冪等操作與版本衝突。
- `npm run build` 後執行 `node node_modules/tsx/dist/cli.mjs scripts/empty-competition-smoke.ts`：在隨機本機埠與獨立臨時資料夾驗證 production build API，不連正式資料庫、不簽發裝置連結；結束後清除測試資料。
- `VALET_LOCAL_DATA_DIR` 只供 local 模式隔離資料使用，不影響 Neon；Vercel 仍禁止 local 模式。
