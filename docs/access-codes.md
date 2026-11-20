# 分層通行碼

這份文件描述單一 VALET 站台如何用通行碼服務多個主辦單位。沒有第三方登入，工作人員也沒有個人帳號。此變更不屬於 2026-11-17 的社內賽，也不改寫該賽事的 15 副牌。

實作分成三個後續 pull request：通行碼與稽核、選手身分、代理 API。合併前都不會對正式資料庫執行遷移。

## 角色

| 範圍 | 能做的事 |
| --- | --- |
| 站台管理員 | 核可主辦單位、簽發與撤銷任何通行碼、看全站稽核 |
| 主辦單位（須為 active） | 建立自己的賽事，並簽發該賽事的裁判、收分、唯讀碼，以及各對收分連結 |
| 賽事裁判 | 控制該賽事；可簽發並撤銷同賽事的收分碼與唯讀碼，不能撤銷其他裁判碼 |
| 賽事收分 | 輸入成績、公開牌型 |
| 賽事唯讀 | 只能讀 |
| 搭檔收分連結 | 只操作該對的收分卡。既有 `club.tokens` 雜湊直接成為這種碼 |
| 選手個人碼 | 只管理自己的個人頁與個人碼 |

主辦單位建立時是 `pending`。管理員核准後才變成 `active`。未核准的主辦碼不能建立賽事。

代理程式使用賽事碼，不另設帳號。經由 API 的操作在稽核裡標 `viaAgent`。

## 儲存

通行碼只存 SHA-256。明文只在簽發當下回傳，用來組成連結與 QR。

```ts
type Organizer = { id: string; name: string; status: 'pending' | 'active'; createdAt: string }
type AccessCode = {
  id: string
  name: string
  hash: string
  scope: 'admin' | 'organizer' | 'event' | 'pair' | 'player'
  role?: 'referee' | 'scoring' | 'read'
  organizerId?: string
  eventId?: string
  pairId?: string
  playerId?: string
  issuedBy: string
  expiresAt: string | null
  revokedAt: string | null
  createdAt: string
}
```

賽事只多一個可選的 `organizerId`。Neon 將它存在 `bridge_stages.settings`。指定主辦單位時，牌組、成績、`club.tokens` 和 `publishBoards` 保持原樣。

主辦單位、通行碼與稽核是附加表：`bridge_organizers`、`bridge_access_codes`、`bridge_access_audit`。結構遷移只建立空表。明文密碼不進表，也不進稽核。

稽核是另一份附加紀錄，不塞進賽事 JSON：

```ts
type AccessAudit = {
  at: string
  actorCodeId: string
  actorName: string
  action: string
  target: string
  before: unknown
  after: unknown
  viaAgent: boolean
  organizerId?: string
  eventId?: string
}
```

管理員看全站。主辦單位與該賽事裁判看自己的賽事。收分、唯讀與選手看不到稽核。

## 到期與撤銷

時間以台北時區計算。

| 碼 | 預設到期 |
| --- | --- |
| 主辦單位、選手個人碼 | 沒有到期，可隨時撤銷 |
| 賽事碼 | 賽事結束日（沒有結束日就用開始日）再加 7 日的 23:59:59 |
| 搭檔收分連結 | 賽事結束日當天 23:59:59 |

撤銷權：管理員可撤銷任何碼。主辦單位可撤銷自己簽發的賽事碼，以及自己賽事裡的搭檔收分連結。裁判可撤銷同賽事的收分碼與唯讀碼，不能撤銷其他裁判碼。選手只能撤銷或重發自己的個人碼。

## 連結登入

通行碼放在網址片段，例如 `https://host/enter#code=...`，不放在 query string。頁面載入後用片段向 `/api/access/session` 換工作階段 cookie，再用 `history.replaceState` 清掉片段。Query 上的 `code` 不視為登入。

既有搭檔收分連結維持原路徑與原雜湊，遷移只另外登記一筆 pair 碼。

## 遷移

`migrateAccessModel` 是純函式，不連資料庫。

- 站台管理員碼使用另行設定的 `SITE_ADMIN_PASSWORD`。它不能等於現有的 `ADMIN_PASSWORD` 或 `DIRECTOR_PASSWORD`。
- 現有 `DIRECTOR_PASSWORD` 的雜湊成為主辦單位「台大橋藝社」的主辦碼。該單位狀態為 active，既有賽事都標上它的 `organizerId`。今天的 `ADMIN_PASSWORD` 不寫入這次遷移。
- 每個 `club.tokens` 值（已是雜湊）複製成 pair 碼。
- 回傳的賽事與輸入共用同一組 `boards`、`results`、`club` 物件；呼叫端可再檢查牌組位元組。

本機檔案腳本 `scripts/migrate-access-codes.ts` 只接受 JSON 檔，且必須設定 `MIGRATE_ACCESS_CODES=1`。它拒絕路徑裡出現 `DATABASE_URL`。

正式資料庫用另一支指令。它走 `neon()` 的 HTTPS，不開 5432。指令要求儲存開關為 `normalized`，只寫通行碼相關表與 `bridge_stages.settings`。已存在的碼列不會被覆蓋。先跑結構遷移，讓三張新表存在：

```bash
npm run db:migrate
VALET_ACCESS_CODES=1 npm run db:migrate-access -- --dry-run
VALET_ACCESS_CODES=1 npm run db:migrate-access
```

`SITE_ADMIN_PASSWORD` 與 `DIRECTOR_PASSWORD` 放在環境，不放在指令參數。正式跑應印出 `deals: unchanged`。再跑一次應是 `events: 0`、`codes: 0`。不要把這支指令指向尚未備份的正式庫，也不要改 `58f461bf-e3df-4dab-b5ac-88ba69025f2d` 的牌。

## 選手與代理

選手以姓名與 email 自助登記。email 存在 `bridge_players`，公開物件不包含它。綁定與待確認通知在 `bridge_pair_bindings` 與 `bridge_partner_notices`。賽事成績從正規化賽事儲存讀出。遺失個人碼時重發並作廢舊碼。綁定搭檔有三條路：登記時依姓名建議並由選手確認、用過該對收分連結的人可一鍵把賽事存進個人頁、一方綁定後若另一方已登記就建立待確認通知。個人頁預設公開，改私人只藏個人頁，賽事頁仍顯示姓名與成績。

代理程式直接在每次請求送出 `Authorization: Bearer <賽事通行碼>`。使用發給該賽段的碼，唯讀碼可查狀態，收分碼與裁判碼可試算與提交成績。完整契約見 [代理 API](agent-api.openapi.yaml)。

1. 呼叫 `GET /api/agent/events/{eventId}/status` 取得目前的 `revision`、圈次、待收分桌次及已公開的牌號。
2. 呼叫 `POST /api/agent/events/{eventId}/preview` 試算輸入成績（`results`）、匯入 CSV（`results-import`）或清除單筆成績（`clear-result`）。這些操作只處理成績。牌組、牌型公開設定、賽程和其他指令皆禁止。
3. 將相同 JSON 送到 `POST /api/agent/events/{eventId}/mutations`，並以 `Idempotency-Key` 標頭傳送此次操作的唯一鍵。外層與 `command` 內的 `requestId` 須使用同一個 UUID，例如 `{"requestId":"00000000-0000-4000-8000-000000000001","command":{"action":"clear-result","requestId":"00000000-0000-4000-8000-000000000001","revision":1,"assignmentId":"桌次 ID","board":1}}`。

提交成功後會回傳新版本。相同賽段、通行碼及冪等鍵的重試會回傳原版本結果，即使之後有其他分數寫入。相同鍵搭配不同 JSON，或相同 `requestId` 搭配新鍵均回傳 409。物件欄位順序與 JSON 空白不影響內容比對。遇到版本衝突時，重新取得狀態、試算，並使用新的 UUID 與冪等鍵提交。成功的提交才會儲存冪等結果與 `viaAgent` 稽核，並與成績寫入共用一個交易。

代理 API 使用 Neon 儲存模式及 `SESSION_SECRET`。先用 `npm run db:migrate` 建立 `bridge_agent_mutations` 等附加表，狀態查詢及預覽支援舊文件模式及正規化模式。寫入只支援正規化模式，未啟用時回傳 503（`AGENT_NORMALIZED_STORAGE_REQUIRED`）。缺少必要資料表時回傳 503。代理 API 與既有登入共用每個來源 IP 的十分鐘失敗計數。被限制時回傳 429，`Retry-After` 標頭提供等待秒數。

## 尚未決定

- 站上還沒有寄信服務。選手重發個人碼的函式已留信箱介面，正式寄送方式要另選。
- 工作階段撤銷要在每次請求讀取通行碼紀錄。這份 PR 提供檢查函式與新的換票路由，尚未取代現有裁判密碼登入，避免未核可就改掉今晚的入口。
