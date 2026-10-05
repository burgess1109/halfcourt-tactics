# 半場戰術板（Halfcourt Tactics）

[![CI](https://github.com/burgess1109/halfcourt-tactics/actions/workflows/ci.yml/badge.svg)](https://github.com/burgess1109/halfcourt-tactics/actions/workflows/ci.yml)

**線上試玩：<https://burgess1109.github.io/halfcourt-tactics/>**

3 對 3 半場籃球戰術 Web 小遊戲。設定你的球隊、選擇或自己畫進攻戰術，系統依對位即時模擬防守，播完後告訴你這一球的評分（0–100）、評等，以及哪裡可以更好。

- 純前端靜態網頁，沒有後端、不需要帳號
- 可以安裝到手機主畫面、離線使用（PWA）
- 介面：繁體中文

## 功能

- **球隊設定**：藍隊（你）三名球員的號碼、暱稱、身高與五項能力（中距離投射、弧外投射、速度、禁區終結、單打）；紅隊（系統）的身高與速度
- **比賽設定**：選擇計分規則（FIBA 3x3 或一般規則）；在小球場上擺開局站位、指定持球者，或套用常用陣型；設定誰盯誰
- **紅隊的防守方式**（比賽設定的防守設定）：防守距離（一般 / 緊貼）、持球者切入時（不補防 / 弱邊補防）、遇到掩護時（換防 / 擠過，擠過時再選沉退 / 上提）
- **戰術庫**：18 套內建戰術（擋拆、空切、無球掩護、手遞手、單打），依你的球隊能力與對位模擬後推薦前 5 名；5 套跳投戰術會依球員能力自動選中距離或弧外出手
- **自己畫戰術**：跑位、運球、傳球、掩護、投籃，最多 12 個分鏡，支援手繪路線與 5 步復原
- **播放與評分**：紅隊由防守模擬即時反應（人盯人、阻絕、換防、擠過、補防），播完後顯示評等、0–100 分（有效命中率）、預期得分與 3–5 條評價，點評價可以跳到對應的分鏡
- **存檔與分享**：存到瀏覽器的戰術列表、匯入匯出 JSON、產生分享連結（對方打開是唯讀預覽，可以另存）

模擬完全**決定性**：同樣的戰術一定得到同樣的結果，不判定投籃進或不進，只計算期望值。計分規則可選 FIBA 3x3（弧內 1 分、弧外 2 分、12 秒進攻時限，預設）或一般規則（弧內 2 分、弧外 3 分、24 秒）。

## 快速開始

需要 [Node.js](https://nodejs.org/) **22.12 以上**（Vitest 5 的要求）。

```bash
git clone https://github.com/burgess1109/halfcourt-tactics.git
cd halfcourt-tactics
npm install
npm run dev
```

打開終端機顯示的網址（預設 <http://localhost:5173/>）。

## 指令

| 指令 | 說明 |
|---|---|
| `npm run dev` | 開發伺服器（修改後自動重新載入） |
| `npm test` | 單元測試（Vitest） |
| `npm run typecheck` | 型別檢查 |
| `npm run build` | 型別檢查 + 打包到 `dist/` |
| `npm run preview` | 在本機預覽打包結果（測試 PWA、離線功能用這個） |
| `npm run plays-doc` | 由戰術資料重新產生 `docs/PLAYS.md` 與分鏡圖 |

## 部署

推到 `main` 後，GitHub Actions（`.github/workflows/ci.yml`）會自動執行型別檢查、測試、打包，並部署到 GitHub Pages。

`npm run build` 產生的 `dist/` 是純靜態檔案，可以放到任何靜態主機（GitHub Pages、Netlify、Cloudflare Pages 等），放在子目錄也可以。

- 要用 **HTTPS**（或 `localhost`），PWA 的離線功能與安裝到主畫面才會啟用。
- 存檔只在使用者自己的瀏覽器（localStorage），換裝置要用 JSON 匯出匯入或分享連結。

## 技術

- TypeScript + Vite + 原生 Canvas 2D，**沒有執行期相依套件**（不用 React 等框架）
- 測試：Vitest
- PWA：vite-plugin-pwa（只在打包時使用）
- 分享連結：瀏覽器內建的 CompressionStream（deflate-raw）+ base64url

## 專案結構

```
src/
  court/   FIBA 半場尺寸、弧內外判斷
  geom/    向量、樣條、路線簡化
  model/   資料模型與規則：戰術、分鏡、路線、對位、存檔與分享格式
  sim/     防守模擬與評分（純函式、完全決定性，係數集中在 sim/config.ts）
  anim/    時間軸與播放
  plays/   內建戰術庫與推薦演算法
  render/  Canvas 繪圖
  input/   指標事件（拖曳、畫線）
  ui/      DOM 介面
docs/      規格、規劃、戰術說明
```

## 文件

| 文件 | 內容 |
|---|---|
| [`docs/SPEC.md`](docs/SPEC.md) | 產品規格：目前實作的流程、模擬、評分、資料模型 |
| [`docs/PLANNING.md`](docs/PLANNING.md) | 專案規劃：里程碑、決策紀錄、待確認清單 |
| [`docs/PLAYS.md`](docs/PLAYS.md) | 18 套內建戰術的說明與分鏡圖（由程式產生） |
| [`CLAUDE.md`](CLAUDE.md) | 開發慣例與架構說明（給開發者與 AI 協作工具） |

## 參與開發

有問題、建議或想討論戰術，歡迎到 [GitHub Discussions](https://github.com/burgess1109/halfcourt-tactics/discussions) 回報（遊戲首頁與戰術面板左下角的「問題回報」也會開到這裡）。

也歡迎送 pull request，送出前請確認：

1. `npm run typecheck` 與 `npm test` 都通過；邏輯變更請補單元測試
2. 模擬與評分維持完全決定性（不要使用 `Math.random`），新的係數放在 `src/sim/config.ts`
3. 行為改變時同步更新 `docs/SPEC.md`，並在 `docs/PLANNING.md` 的決策紀錄加一列
4. 改了內建戰術（`src/plays/library.ts`）、防守模擬（`src/sim/`）或配色後，要執行 `npm run plays-doc` 重新產生分鏡圖（測試會檢查是否一致）
5. 介面文字用繁體中文；註解、文件、commit message 用繁體中文或英文皆可

更多慣例見 [`CLAUDE.md`](CLAUDE.md)。

## 授權

[MIT](LICENSE)

第三方元件：工具列與選單圖示使用 [Phosphor Icons](https://phosphoricons.com/)（MIT），PWA 的 service worker 由 [Workbox](https://github.com/GoogleChrome/workbox)（MIT）產生。授權全文見 [`public/THIRD_PARTY_NOTICES.txt`](public/THIRD_PARTY_NOTICES.txt)，部署後也會一起發佈。
