# 部署與備份

## Vercel 部署

1. 將此專案推送到自己的 Git repository，在 Vercel Import Project，選 Next.js；Node.js 版本選 22 或相容的受支援版本。
2. 建立 Neon PostgreSQL，取得連線字串。正式與 Preview 使用不同資料庫或 branch。
3. 設定環境變數：

   - `STORAGE_MODE=neon`
   - `DATABASE_URL`：Neon 連線字串（不得使用 NEXT_PUBLIC 前綴）
   - `ADMIN_PASSWORD`：至少 16 字元的獨立隨機密碼
   - `DIRECTOR_PASSWORD`：至少 16 字元、與賽務不同的裁判密碼，供裁判後台操作
   - `SESSION_SECRET`：至少 32 字元隨機字串，可用 `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` 產生

4. 在本機 `.env.local` 設定目標 DB 連線，執行 `npm run db:migrate`，建立 schema。既有資料庫須確認開關已是 `normalized`；全新的空資料庫按 [儲存維護手冊](storage-migration.md) 初始化開關。正式環境登入後自行建立新賽事。
5. 部署。Build command 為 `npm run build`，其餘採 Vercel Next.js 預設。函式區域請與 Neon 接近。
6. 開啟 `/api/health` 確認程式服務；再開首頁確認 DB 可讀，登入建立測試賽事，收分後重新開啟網頁確認持久化。

不需要 Docker 或常駐 Node server。

正式賽事前，請在部署環境驗證資料保存、成績更新與集中收分流程。

## 測試與備份

```sh
npm test
npm run typecheck
npm run build
```

測試涵蓋合約分、IMP 邊界、VP、開閉兩室方向、MP 同分/缺分/更正、輪空、CSV/PBN、重送與版本衝突。

- 正式 DB 備份以 PostgreSQL `pg_dump --format=custom --file=Valet.dump` 執行，連線資訊透過 PG 環境變數提供，將檔案存至部署之外的儲存空間。
- 還原先建立獨立測試 DB，使用 `pg_restore --no-owner --dbname=<測試資料庫名稱> Valet.dump`（主機/帳密由 PG 環境變數設定），核對場次、revision、成績及稽核筆數後才考慮正式切換。不要對正式資料庫直接試還原。
- 後台 JSON 匯出方便攜出及檢查，目前沒有網頁 JSON 還原按鈕，不能取代 DB 備份。
- Vercel 程式回退不會回退 DB；新增 schema 應向後相容。

WBF VP 來源：https://www.worldbridge.org/wp-content/uploads/2019/06/VP-Scale-Functiondetails.pdf

## 登入與權限

變更 ADMIN_PASSWORD 會撤銷現有賽務登入；變更 DIRECTOR_PASSWORD 會撤銷裁判登入；輪換 SESSION_SECRET 會撤銷全部登入。升級此版後，舊登入憑證也需重新登入。使用 Vercel 環境變數更新時須重新部署才會生效。

賽務可收分、更正、取消/恢復成績、扣分與維護入座名單。裁判另可匯入資料、調整賽程、公開牌型、管理隊伍名單、設定不平衡合約、建立與刪除賽事。俱樂部專屬連結只能操作自己的當圈桌次。角色規則集中於 lib/mutation-permissions.ts。

部署前執行 npm run check:secrets、npm audit、npm test 與 npm run build。模式掃描只能識別已列出的秘密格式，不能保證歷史或主機設定沒有秘密；不要將 .env、資料庫備份或真實登入憑證加入 Git。

## 場館與賽場位置資料轉換

適用於已切換至正規化儲存的站台。先在維護環境設定 `DATABASE_URL`，並預覽舊資料。建議在開放裁判編輯新版賽事資訊前先保留預覽報告。

```sh
VALET_CONVERT_VENUE=1 npm run db:convert-venue-prefix -- --dry-run
VALET_CONVERT_VENUE=1 npm run db:convert-venue-prefix
```

確認預覽內容後再執行第二行。腳本逐欄比對已確認的舊值並保留人工修改。「115-1 社內賽」（8b01f0c3）的預演與正賽可從舊場地「臺灣大學 二活704」補上賽場位置「704」；獨立「老少盃」（64c0734e）將賽事場地改為「台灣大學 第二學生活動中心」，並補上賽場位置「603」。這兩項新增對照都保留賽段的舊場地欄位。其他賽事與待確認的欄位、賽段列在 `Skipped – needs a human decision`。兩種執行模式皆會回報 8b01f0c3 的主辦單位名稱與 ID。若賽段缺少指派，或解析結果與「台大橋藝社」(`ntu-bridge-club`) 不符，列為待人工確認。腳本只讀取主辦單位資料與賽段指派。已套用的項目重跑時顯示零筆變更。遇到版本衝突時整批回滾，重新預覽後再執行。既有資料表與牌局資料均保留。

## 每桌狀態表遷移（PR 1）

先在 Neon 的複本分支演練。由執行環境注入該分支的 `DATABASE_URL`，確認儲存切換已啟用 normalized，依序執行：

```bash
npm run db:migrate-per-table -- --dry-run
VALET_PER_TABLE_MIGRATION=1 npm run db:migrate-per-table -- --apply
VALET_PER_TABLE_MIGRATION=1 npm run db:migrate-per-table -- --apply
VALET_PER_TABLE_MIGRATION=1 npm run db:migrate-per-table -- --down
```

核對預計新增筆數與第一次回填相符，第二次執行顯示「新增 0」，各賽段的既有資料表筆數及指紋全程一致。可重複指定 `--event <id>`，在輸出中特別標出該賽段的牌型與成績指紋。出現影子資料差異時，先查明原因再回退。

正式環境請在無進行中賽事的維護時段執行。順序是先部署 PR 1，再執行預覽及兩次回填：PR 1 在新資料表建立前不寫影子資料，而且每次寫入都會重新檢查資料表是否已建立，所以回填完成後的寫入會自動維護影子資料，不需要重新啟動。不要在部署 PR 1 之前回填，否則舊版程式之後的寫入不會更新影子資料。執行前先備份。若某賽段的指紋檢查失敗，該賽段會回滾，先前完成的賽段可保留並在排除原因後重跑。

若要回退，先暫停寫入並切回舊版服務，再執行 `--down` 清理已驗證一致的影子資料與遷移紀錄。正規化的既有資料仍是 PR 1 的讀取與衝突判斷來源。回退保留新資料表，且影子資料有差異時會拒絕清理。請在維護時段完成回退後再恢復服務寫入。
