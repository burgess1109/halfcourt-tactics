# CLAUDE.md

## 語言

**一律使用繁體中文（台灣用語）**：回覆、code review 意見、程式碼註解、文件、測試名稱、介面文字都用繁體中文。
例外：識別字（變數、函式、檔名）用英文；git commit message 用英文。

## 專案簡介

3 對 3 半場籃球戰術 Web 小遊戲（PWA）。使用者固定操作**藍隊**、系統固定操作**紅隊**。v1 只做**進攻模式**：使用者設定球員 → 對位 → 選內建戰術或自己畫跑位 → 播放，紅隊由防守 AI 即時反應，之後評分（M7）。防守模式暫緩。

技術：TypeScript 7 + Vite 8 + 原生 Canvas 2D，測試用 Vitest 5。**沒有任何執行期相依套件**（不用 React 等框架）。

## 規格文件（以這些為準）

| 檔案 | 內容 |
|---|---|
| `docs/SPEC.md` | 產品規格書。§1 流程、§3 球員資料、§4 路線、§5 分鏡與播放、§6 模擬引擎（防守 AI、戰術庫、評分）、§7 能力模型、§11 資料模型、§13 里程碑、§14 決策紀錄 |
| `docs/PLAYS.md`、`docs/plays/*.svg` | 18 套內建戰術的說明與分鏡圖。**由程式產生，不要手改**：改 `src/plays/library.ts` 後執行 `npm run plays-doc` |

- 行為改變時，要同步更新 `docs/SPEC.md`，並在 §14 決策紀錄加一列（被取代的舊決策用 `~~刪除線~~` 標註，不要直接刪掉）。
- 里程碑狀態見 SPEC §13（M1–M7 已完成，M8 存檔分享、M9 防守模式）。

## 常用指令

```bash
npm run dev         # 開發伺服器
npm test            # 單元測試（Vitest）
npm run typecheck   # 型別檢查
npm run build       # 型別檢查 + 打包
npm run plays-doc   # 由戰術資料重新產生 docs/PLAYS.md 與分鏡圖
```

## 程式架構

```
src/
  main.ts          進入點：畫面切換（首頁 / 設定 / 戰術面板）、接起各模組
  court/fiba.ts    FIBA 半場尺寸常數、isBeyondArc（弧內 1 分 / 弧外 2 分，含底角直線段）
  geom/            純幾何：向量、Catmull-Rom 樣條、RDP 簡化、折線
  model/           資料模型與規則（純函式為主）
    types.ts         Tactic / Frame / Player / TacticPath 等型別（對應 SPEC §11）
    store.ts         狀態容器：update（暫時變更）、commit / begin / end（寫入 5 步復原）
    frames.ts        分鏡串接 syncFrames：後面分鏡的起始狀態 = 上一分鏡的結束狀態；紅隊位置來自防守模擬
    paths.ts         路線規則（每人每分鏡一條、運球/傳球/投籃只限持球者、投籃只在最後一個分鏡）
    physique.ts      能力等級、身高預設、速度公式
    matchups.ts      預設對位（有身高依身高、否則依順序）與交換
    lineup.ts        開局站位（三名藍隊的位置與持球者）、常用陣型
    playerForm.ts    設定頁表單驗證
  sim/             防守 AI（純函式，完全決定性）
    config.ts        所有模擬係數（距離、反應時間、掩護、阻絕…）集中在這裡
    defense.ts       防守位置：人盯人、阻絕、被甩開只能從後面追
    defenseSim.ts    以 1/60 秒推進紅隊；掩護的換防 / 擠過
    evaluate.ts      評分：區域、空檔程度、預期得分、評等、3–5 條評價
  anim/            時間軸與播放
    timeline.ts      藍隊依路線與速度移動、傳球時機、投籃、掩護者先站 0.5 秒
    simulation.ts    時間軸 + 防守模擬 = 完整姿態
    playback.ts      requestAnimationFrame 播放
  plays/           內建戰術庫
    library.ts       18 套戰術，用角色 A / B / C 描述
    instantiate.ts   loadPlay：依角色指派載入成戰術「複本」（不會改到內建資料）
    recommend.ts     推薦演算法：能力 + 對位的身高差、速度差，6 種角色排列取最高分
  render/          Canvas 繪圖（球場離屏快取、球員、路線、分身、把手）
  input/pointer.ts 指標事件：拖曳、畫線、編輯控制點、點球員開設定
  ui/              DOM 介面：設定流程（含開局站位小球場）、戰術庫面板、評分卡片、工具列、分鏡列、HUD、選單、提示
scripts/           plays-doc：透過 Vite ssrLoadModule 產生戰術說明
```

依賴方向大致是 `geom/court → model → anim/timeline → sim → model/frames（串接時呼叫模擬）`，再往上是 `render / input / ui → main`。模擬與規則不依賴 DOM，都可以直接寫單元測試。

## 重要慣例與領域規則

- **座標**：世界座標單位是公尺，原點在底線中點，x 向右、y 朝中場；籃框在 `(0, 1.575)`，畫面上籃框在下方、不可翻轉。
- **完全決定性、沒有隨機**：同樣輸入一定得到同樣結果（分享連結要能重現）。不要引入 `Math.random` 進模擬或評分。
- **分鏡**：最多 12 個；只有第 1 個分鏡能拖曳藍隊與球；之後的站位都由路線推算。
- **紅隊由系統控制**：不能拖、不能畫路線；位置一律來自 `sim/`。
- **能力等級**：優勢 / 稍強 / 平均 / 稍弱 / 劣勢（分數 4 → 0），以場上六個人的平均為基準。藍隊有 4 項（外線投射、速度、禁區終結、單打），紅隊只有速度。
- **計分**：FIBA 3x3，弧內 1 分、弧外 2 分。判斷弧內外一律用 `isBeyondArc`，不要只算離籃框的距離（底角是直線）。
- **係數**：模擬、速度相關的數字放在 `sim/config.ts` 或 `model/physique.ts`，不要散落在邏輯裡。
- **介面文字**：繁體中文；狀態變更走 `Store`，需要復原的操作用 `commit` 或 `begin`/`end`，整份換掉（載入戰術、空白戰術）用 `load`。
- **按鈕提示**：用 `data-tip`（`ui/tooltip.ts` 的 `setTip` 可動態更新），不要用 `title`，否則會和自訂提示重複出現；有快捷鍵的寫在括號裡。
- **canvas 大小一定要由 CSS 明確指定**（`width` / `height`）：只靠 `inset` 時瀏覽器會用 canvas 自己的像素大小，而 Renderer 依顯示大小設定像素大小，兩者互相放大會讓頁面當掉。要讓位給其他介面時，改 `#stage` 上的 `--reserve-right` / `--reserve-bottom`。
- **分鏡圖 SVG**：必須是嚴格合法的 XML，不能有重複屬性、不能用 `rgba()`（PhpStorm 的 SVG 檢視器會載入失敗），有測試把關。

## Code review 重點

- 行為改變是否同步更新 `docs/SPEC.md` 與決策紀錄；戰術資料改變後是否重跑 `npm run plays-doc`。
- 模擬是否仍然決定性；新增的係數是否放進 config。
- 路線與分鏡規則（每人每分鏡一條路線、持球限制、投籃只在最後一個分鏡、分鏡串接後的 prune）是否被破壞。
- 內建戰術：載入不能改到 `PLAYS` 本身；每個掩護都要真的擋到防守者；出手說明的分數要和實際位置一致（`plays.test.ts` 有檢查）。
- 手機直式（360–390 px 寬）與橫式版面是否正常；觸控操作（`touch-action: none`、Pointer Events）。

### 刻意的設計（review 時不需要回報）

- 防守距離比真實比賽大（防持球者 1.5 m、無球 2.0 m、最小 1.45 m）：圓標直徑約 1.44 m，太近會疊在一起。
- 「低位擋拆」是 A 幫**已持球**的 B 掩護，屬於持球掩護（擋拆），不是無球掩護（pin-down）。
- 沒有「傳球」能力：模擬不做抄截與失誤，加了也不會影響結果（暫不處理）。
- 傳球者在同一個分鏡不能移動（每人每分鏡只有一條路線）；要「運球後傳球」需分兩個分鏡。
- 掩護者在下一個分鏡會先站住 0.5 秒才移動。

## 驗證方式

- 邏輯變更：補單元測試，`npm test` 與 `npm run typecheck` 都要通過。
- 介面變更：`npm run build` 後 `npx vite preview`，用 headless Chrome（`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` 搭配 `playwright-core`）截圖確認直式與橫式。
