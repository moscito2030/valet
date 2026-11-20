# 正規化儲存維護手冊

Neon 上的賽事、牌組、成績和逐副留言已遷移到正規化表。應用程式及維護工具要求 `bridge_storage_switch` 的 `id = 1` 列為 `normalized`。開關表或列不存在，或模式不是 `normalized` 時，賽事儲存停止讀寫，API 回傳 503「正規化儲存尚未啟用，暫停讀寫。請聯絡站台管理員。」舊格式與一次性資料搬移工具均已退役。

## 結構安裝與開關

```bash
npm run db:migrate
```

結構遷移可重複執行。它建立正規化表、登入限流及討論管理所需的表，並保留開關原狀。既有資料庫先確認開關為 `normalized`。若開關缺失或異常，先核對目標資料庫與正規化資料，再從已驗證的設定恢復該列。單獨建立開關列不會搬移資料。

只有已確認全新的空資料庫，才在安裝結構後初始化開關：

```sql
INSERT INTO bridge_storage_switch (id, mode) VALUES (1, 'normalized')
ON CONFLICT (id) DO NOTHING;
```

`bridge_events` 和 `bridge_discussions` 的舊逐副留言列保留為唯讀歷史備份。現有資料表不會被改名、變更結構或刪除。`bridge_discussions` 的 `global`、`block:*` 和 `limit:*` 列仍供討論管理讀寫。登入限流仍使用 `bridge_login_limits`。舊表水位檢查已移除，正規化儲存可獨立於歷史賽事表運作。

## 合併賽段

```bash
VALET_MERGE_STAGES=1 npm run db:merge-stages -- --dry-run
VALET_MERGE_STAGES=1 npm run db:merge-stages
```

合併把這三個 id 放進同一場賽事，id 本身不變：

- 賽事 `8b01f0c3-dc13-4a5f-9178-cae97fdf5b44`，前綴「台大橋藝社 115-1」，名稱「社內賽」
- 賽段順序：`fed8635d-0737-48ca-a17b-5d4d96884f26`（預演，封存狀態保持原樣）、`55178a2a-1a1e-4106-b525-dc3fe9ae9f50`（正賽）、`58f461bf-e3df-4dab-b5ac-88ba69025f2d`（11月社內賽）

`/?competition=8b01f0c3-dc13-4a5f-9178-cae97fdf5b44` 與 `/?event=58f461bf-e3df-4dab-b5ac-88ba69025f2d` 都繼續有效。舊的 `/?competition=58f461bf-e3df-4dab-b5ac-88ba69025f2d` 和 `GET /api/competitions/58f461bf-e3df-4dab-b5ac-88ba69025f2d` 會導向合併後的賽事。11月社內賽目前自己的賽事列場地是「臺灣大學 二活705」，賽段文件上的場地寫成 704，不對。合併時把賽事列的場地抄進該賽段的 `venue` 與 `venueOverride`，所以畫面上是 705，不會改吃老少盃的場地。乾跑會印 `venue=臺灣大學 二活705`。預演與正賽若本來就有上層賽事，場地不動。牌組、成績、名單、判罰與留言都不改。舊賽事列的稽核與 request id 會併進合併後的賽事，並多一筆「合併賽段」稽核。

## 逐副公開

讀取較早的正規化資料時，`publishBoards` 仍用來推算個別牌局的公開狀態。下面的指令將這個結果保存到缺少 `published` 的牌局，並清除賽段設定中的整場開關。它會核對牌張字串，已明確公開或隱藏的牌列保持原樣。

```bash
VALET_MATERIALIZE_PUBLICATION=1 npm run db:materialize-publication -- --dry-run
VALET_MATERIALIZE_PUBLICATION=1 npm run db:materialize-publication
```

先以乾跑檢查 `stages` 和 `boards` 計數。正式執行會印出 `deals: unchanged`，再次乾跑時兩個計數應為 0。
