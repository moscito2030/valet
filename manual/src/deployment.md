# 部署與備份

本章給維護網站的人。一般裁判與賽員不需要設定伺服器。

## 正式部署

Valet 使用 Next.js，可部署至 Vercel，正式資料使用 Neon PostgreSQL。建置指令使用 `npm run build`；它會一併產生本手冊，不需要另開文件網站專案。

| 環境變數 | 用途 |
| --- | --- |
| STORAGE_MODE | 正式環境設為 `neon` |
| DATABASE_URL | Neon 連線字串，不能加 NEXT_PUBLIC 前綴 |
| ADMIN_PASSWORD | 至少 16 字元的賽務密碼 |
| DIRECTOR_PASSWORD | 至少 16 字元，且不同於賽務密碼 |
| SESSION_SECRET | 至少 32 字元的隨機字串 |
| NEXT_PUBLIC_VALET_REVIEW_URL | 已部署的 Valet Review 網址 |

初始化資料庫時使用專案的 `npm run db:migrate`。正式與 Preview 使用不同資料庫或分支。環境變數變更後重新部署；改密碼會撤銷相應角色的現有登入，改 SESSION_SECRET 會撤銷所有登入。

正式開賽前，用測試賽事驗證建立、手機送分、對手確認、結算、公開分數及重新開啟後資料仍存在。`/api/health` 僅能證明程式回應，不能代替整個流程驗收。

### 架構整理後的回歸確認

內部模組整理不改變賽事網址、計分規則或裁判操作方式。更新後請確認總排名搜尋、圈次切換、逐副成績與隊伍／搭檔成績仍正常；切換分頁時，原本的選擇狀態應保留。

裁判私下檢視仍只作用於目前裝置；切換賽段、牌號或分頁會關閉私下檢視，其他觀眾仍只能取得已公開的資料。請用另一個未登入的瀏覽器確認公開範圍，勿以裁判畫面代替觀眾驗收。

## 備份與復原

資料庫備份應另存於部署以外的儲存空間，例如由管理者使用 PostgreSQL `pg_dump`。還原先在獨立測試資料庫演練，核對賽事、成績與操作紀錄，再安排正式復原。

Vercel 回退程式版本不會回退資料庫；後台 JSON 匯出也沒有對應的一鍵還原流程。

## 更新手冊

手冊原稿位於 repo 的 `manual/src/`，目錄為 `SUMMARY.md`，樣式在 `manual/theme/valet.css`。修改後執行：

```sh
npm run manual:build
npm run manual:check
npm run build
```

建置腳本下載固定版本的官方 mdBook，檢查 SHA-256 後執行；第一次需要連上 GitHub。產物在 `public/manual/`，由建置產生，不加入 Git。平時修改原稿後重新執行 `manual:build`，本機 `/manual/` 即可查看。

功能更新時一起修改操作步驟；不應把測試密碼、真實連線字串、專屬收分連結或備份檔放進公開手冊。

## 查看部署版本

網站側邊欄底部與頁尾會顯示 `Valet · commit 短碼`，點擊可開啟 GitHub 的完整 commit 與訊息。版本在建置時固定，代表目前部署的程式版本，而非倉庫最新版本。

Vercel 使用系統提供的 `VERCEL_GIT_COMMIT_SHA` 與 `VERCEL_GIT_COMMIT_MESSAGE`，不需手動填入 commit。若正式部署顯示「版本資訊未提供」，請確認 Vercel 專案允許提供系統環境變數，並重新部署。本機未提供部署資訊時顯示「本機開發版」。

### 共用檢視器依賴

部署使用 `vendor/` 內的共用檢視器封裝檔，不能依賴開發電腦的相鄰專案目錄。建置前會檢查 lockfile 是否含本機連結或不可攜路徑；更新套件後也應在獨立目錄執行乾淨安裝，避免既有 `node_modules` 掩蓋依賴問題。
