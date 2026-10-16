# 賽程編排 與隨機發牌

裁判後台的「匯入／匯出」提供編排預覽、套用與隨機 PBN 產生。

## 賽程編排

建立賽段可先留空圈數；在裁判介面設定圈數與每圈牌數，再預覽可用編排。套用時會更新賽段圈數與牌局安排。完整操作請見[使用手冊](../manual/src/movement.md)。
全場同牌輪轉可用於目前支援的所有規模；奇數桌使用 Mitchell，偶數桌使用 Skip Mitchell 或共牌／中繼桌 Mitchell。
Howell 使用內建編排表：完整 Howell 為 3–8 桌，Reduced（3/4）Howell 為 4–10 桌的表列圈數，最多 15 圈。
奇數對數以缺席的最高編號作為輪空對。預覽顯示實際桌次並提示輪空、共用牌組及牌數變更。
套用會替換整個未收分賽段的編排，保留相同牌號牌型，新增空白牌型，移除超出範圍的牌號；不得在已有任何成績（含取消）時套用。

數字編排資料來源（2026-10-16 擷取）：

- https://bridgecentral.com/4Tables.htm 至 https://bridgecentral.com/10Tables.htm ，各 Howell / Reduced Howell 表。資料保存 source 與 sourceName。
- https://web.mit.edu/mitdlbc/www/bridgemats/Wide/H0305.PDF ，三桌五圈。
- 選擇背景：https://en.wikipedia.org/wiki/Duplicate_bridge_movements#Choice_of_movements

所有內建選項皆以測試驗證：每圈每對只上場一次、桌次完整、同對不重打牌、Howell 不重遇對手。

## 奇數隊隊制編排

3–31 隊奇數隊可選輪空循環，每圈一隊輪空；隊制圈數上限為 31，每圈最多 16 副，總牌數不另設固定上限。輪空由賽程中缺席的隊伍推導，`byeVp` 預設 12，賽前可設 0–20。`Projection.byes` 分別保存圈次、隊伍、VP 與是否已收齊該圈而計入排名；不建立假的 assignment/result。清分後自動撤回輪空分。

`team-interleaved-3`／`team-interleaved-5` 支援隊數被 3／5 整除、圈數為 2／4 倍數的多組多循環編排。舊 `team-interleaved` ID 保留供原本三／五隊呼叫使用。`interleavedGroups` 為各循環、各組的隊伍 ID 陣列，未指定時依名單分組；伺服器逐循環驗證隊伍完整且不重複。不同循環可改組，每個循環內 NS 固定桌號，EW 位移依序為 `+1,-1`（三隊）或 `+1,-1,+2,-2`（五隊），以零起算索引計算牌組 `(NS 索引 + EW 索引) mod 隊數`。奇數隊數下，同圈同組內每桌不同牌組，同一 NS／EW 搭檔不重打牌，互換方向的對戰拿到同組牌。每兩圈完成一批比較；每場以每圈牌數換算完整 20–0 VP。各組使用相同牌號複製牌，循環之間牌號不重複；matchId 含循環與組別以免錯配。CSV 從首兩圈對戰圖推導組別大小，再檢查每循環的完整同組對戰、方向與牌號，不依賴 matchId 命名。畫面共用 roundLabel 顯示循環－圈次，資料與 CSV 保留連續整數圈號。

跨圈兩桌共用 `matchId`，保留 open/closed 表示比較方向。`MatchScore.round` 是兩桌中較後圈次；`teamMovement: interleaved` 供畫面顯示實體桌次及多對手比較。CSV 增加 matchId，一次驗證完整賽程，已有成績禁止重匯。一般隊制 CSV 仍接受逐圈匯入。個人 Butler 在交錯循環改為同牌跨圈全場比較，等所有使用該牌的圈次完成後統計；同一循環內固定搭檔方向也納入入座名單驗證。

資料仍存於既有賽段 JSON，不需資料庫結構遷移。未設定新欄位的舊賽事沿用原計分；尚未實作自動 Swiss 配對。

## Deal Source

語法依 https://www.bridgebase.com/tools/dealer/Manual/input.html 的常用發牌條件實作，非完整 Dealer 執行檔。
支援條件、變數、註解、predeal、generate、produce、dealer、vulnerable、pointcount；支援 hcp、花色長度、shape、hascard、controls、losers、大牌張數與一般數值／邏輯運算。
尚未支援 tricks、cccc、quality、altcount、ptN、score、imps 及統計 action；不支援內容會報錯，不會忽略。
輸出固定 PBN，`action printpbn` 可以省略；也接受 `action printall`、`action printoneline`，輸出格式仍為 PBN。
採 Web Crypto 均勻洗牌，predeal 先固定指定牌，再洗剩餘牌；條件以拒絕抽樣篩選。未達指定副數時不回傳部分結果。
最多產生本賽段的牌數，搜尋限制為 100 萬次嘗試、30 秒；可取消。Source 不作 JavaScript 執行，也不傳至外部網站。
produce 預設本賽段牌數，可減少以供下載；套用需要全部牌號，沿用既有 PBN 匯入的裁判權限、版本與未收分檢查。
