# 儲存遷移手冊

這份手冊給維護者自己執行。程式可以先合併、先上線；在你把儲存開關切到 `normalized` 之前，網站繼續讀寫舊的 `bridge_events`。不要把資料庫網址、密碼或牌張貼進工單或聊天。

這些腳本只用 `@neondatabase/serverless` 的 `neon()`，走 HTTPS。不要用 `psql`、`pg_dump` 或 Postgres 的 5432 埠；那台機器連不到。需要原子寫入的地方用 `sql.transaction([...])`，一次送出整批語句，中間不讀結果。

## 安全順序

順序不能對調。舊版程式不認識開關；若在舊版還在服務時把開關切成 `normalized`，舊版會繼續寫舊表，新版會讀新表，成績就會裂開。新版遇到這種情況會停止讀寫，而不是猜哪一份才對。

1. 先合併這個 PR 到 `master`。合併會自動部署。此時資料庫可以還沒有新表，網站仍用 `bridge_events`。
2. 在 Neon 從目前的 production 建立分支，當作備份。之後的試跑都連這個分支。
3. 對分支跑結構遷移。它只建立新表，並把開關維持在 `legacy`。不修改、不刪除 `bridge_events`。
4. 對分支乾跑資料遷移，看印出的計數與 id。
5. 對分支正式跑資料遷移。請在網站沒有人收分時做這一步。每一場先寫入並核對；水位和文件在同一句 SQL 讀出，避免中間有人寫入卻沒被複製。水位用 `updated_at` 的文字比對，保留微秒。全部通過後才切換。若切換當下舊表又被寫過，腳本不會翻開關，會再複製一次。連試五次仍對不上就停在 `legacy`，網站繼續讀舊表。
6. 對分支乾跑合併賽段，再正式合併。合併必須在開關已經是 `normalized` 之後。
7. 用分支把公開頁、收分連結與十五副牌抽查看過。
8. 確認分支沒問題後，對 production 重複第 3 到第 6 步。結構遷移與資料遷移要接連做：結構遷移之後，已部署的程式會在寫入時鎖開關；資料遷移的最後一步才翻面。

不要先跑資料遷移再部署。也不要在乾跑階段把 production 的網址拿來寫入。

## 分支上的指令

在自己的殼層設定分支的 `DATABASE_URL`。不要把網址寫進檔案或提交。

```bash
npm run db:migrate
```

結構遷移成功時印出：

```text
Migration complete: bridge_events, normalized tables, storage switch left on legacy
```

```bash
VALET_DATA_MIGRATION=1 npm run db:migrate-data -- --dry-run
```

乾跑會真的把每一場寫進新表再在同一筆交易裡刪掉，所以結束後 `bridge_stages` 仍是空的，開關仍是 `legacy`。它印計數與 id，例如：

```text
mode: dry-run
events: 2
event: <event-id> boards=15 results=20 participants=8 penalties=0 audit=4
competitions: 1
competition: <competition-id>
discussions: 0
verified: 3
flip: no
```

`verified` 是這次核對過的賽事列與賽事列合計。`flip: no` 表示沒有切換。乾跑結束後 `bridge_stages` 應該還是空的。

```bash
VALET_DATA_MIGRATION=1 npm run db:migrate-data
```

正式遷移最後幾行應是：

```text
mode: write
events: 2
event: <event-id> boards=15 results=20 participants=8 penalties=0 audit=4
competitions: 1
competition: <competition-id>
discussions: 0
verified: 3
flip: normalized
```

核對內容是：每場的牌組 JSON（`JSON.stringify` 後的牌張字串，順序與內容都要相同）、成績、參賽者、判罰、稽核筆數與內容、以及由這些列算出來的名次。任一項不合，該場交易會回滾，開關維持 `legacy`，終端只印 `verify failed <id>: deals` 這種欄位名稱，不印牌張或憑證。

若再跑一次，會拒絕覆蓋已上線的新表，並印出：

```text
flip: already-on
refusing: copying legacy rows would overwrite the live normalized store
```

```bash
VALET_MERGE_STAGES=1 npm run db:merge-stages -- --dry-run
VALET_MERGE_STAGES=1 npm run db:merge-stages
```

合併把這三個 id 放進同一場賽事，id 本身不變：

- 賽事 `8b01f0c3-dc13-4a5f-9178-cae97fdf5b44`，前綴「台大橋藝社 115-1」，名稱「社內賽」
- 賽段順序：`fed8635d-0737-48ca-a17b-5d4d96884f26`（預演，封存狀態保持原樣）、`55178a2a-1a1e-4106-b525-dc3fe9ae9f50`（正賽）、`58f461bf-e3df-4dab-b5ac-88ba69025f2d`（11月社內賽）

`/?competition=8b01f0c3-dc13-4a5f-9178-cae97fdf5b44` 與 `/?event=58f461bf-e3df-4dab-b5ac-88ba69025f2d` 都繼續有效。舊的 `/?competition=58f461bf-e3df-4dab-b5ac-88ba69025f2d` 和 `GET /api/competitions/58f461bf-e3df-4dab-b5ac-88ba69025f2d` 會導向合併後的賽事。11月社內賽目前自己的賽事列場地是「臺灣大學 二活705」，賽段文件上的場地寫成 704，不對。合併時把賽事列的場地抄進該賽段的 `venue` 與 `venueOverride`，所以畫面上是 705，不會改吃老少盃的場地。乾跑會印 `venue=臺灣大學 二活705`。預演與正賽若本來就有上層賽事，場地不動。牌組、成績、名單、判罰與留言都不改。舊賽事列的稽核與 request id 會併進合併後的賽事，並多一筆「合併賽段」稽核。

沒有帶對應的環境旗標時，三支寫入腳本都會直接拒絕。

## 這次刻意維持的行為

- 一場賽事最多 32 個賽段。架構審查認為要等有租戶之後再放寬，否則一份封存會占滿全域上限。這次不改這個錯誤。
- 公開 API 仍是 `Cache-Control: no-store`。現場成績不進 CDN。投影存在賽段列上，讀取用這份快取；寫入仍呼叫原本的 `project()`，名次與今天相同。MP、IMP 與淘汰的名次依賴同一副的全部成績，所以不改成增量算法。
- 只有同一桌、同一副的成績寫入會衝突。不同桌同時送同一副牌，兩邊都成立。
- 舊文件模式的 `requestId` 仍只留最後 500 筆。切到新表之後不再截斷。

## 還原

開關仍是 `legacy` 時，網站本來就在用舊表。把 Neon 分支丟掉或還原即可，新表可以留著。

開關已經是 `normalized`，而且切換之後有新成績時，不要只把開關撥回去，否則那些成績只在新表。兩種做法：

1. 還原遷移前建立的 Neon 分支。切換之後的寫入會消失，舊表回到當時的位元組。
2. 先把新表組回舊表，再切回 `legacy`：

```bash
VALET_RESTORE_LEGACY=1 npm run db:restore-legacy -- --dry-run
VALET_RESTORE_LEGACY=1 npm run db:restore-legacy
```

正式還原印出 `switch: legacy`。同一筆交易裡，新表沒有的舊列會刪掉，所以合併後退役的賽事列不會留在 `bridge_events`。`limit:`、`block:` 與 `global` 開頭的討論列是流量限制，刻意留在舊表，不會刪。它會把牌張逐張核對。舊表是 jsonb，鍵的順序可能和 text 欄位裡的原始 JSON 不同；花色與點數必須相同。新表不會刪。

若還原腳本或網站印出「舊的 bridge_events 在切換之後又被寫入」，表示有人用舊程式寫過舊表。這時不要繼續寫，直接還原 Neon 分支。

## 稍後手動，這次不要執行

確認新表已單獨服務一段時間、而且你另有備份之後，才可以考慮停用舊表。下面的語句不在任何腳本裡，預設不要跑。

```sql
-- 稍後手動。會刪掉舊文件。確定沒有人還要讀 bridge_events 再執行。
-- ALTER TABLE bridge_events RENAME TO bridge_events_legacy;
-- DROP TABLE bridge_events_legacy;
```
