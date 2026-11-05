# H3 Storyboard Studio — 工程實作工單清單 (TICKETS.md)
*遵循 Matt Pocock `to-tickets` 規範：將規格書拆解為具體、可驗證、具備驗收準則的工程工單。*

---

## [TICKET-01] 領域模型與術語規範化 (Ubiquitous Language)
- **狀態**：`[COMPLETED]`
- **目標**：解決概念歧義（如「風獅爺方案」vs「預設方案」、「分段秒數」與「九宮格尾幀」之綁定關係）。
- **驗收準則 (Acceptance Criteria)**：
  - [x] 建立 `GLOSSARY.md`，定義 6 大核心領域實體與 3 大執行步驟。
  - [x] 建立 `SPEC.md`，定義 `StoryboardPlan` 與 `StoryboardSegment` 的 TypeScript/JSON 資料規格。

---

## [TICKET-02] 抽取時間軸與時長計算純函數 (`timecodeHelper.js`)
- **狀態**：`[COMPLETED]`
- **目標**：將 HTML 內散落的秒數計算與分段標題邏輯解耦至獨立純模組。
- **實作模組**：`src/core/timecodeHelper.js`
- **驗收準則 (Acceptance Criteria)**：
  - [x] `getSegmentTimeRange(index)`：正確計算 `[startSec, endSec]`。
  - [x] `calculateTotalSeconds(count)`：返回 $5n$ 整數秒。
  - [x] `calculateDefaultEndPanel(index, total)`：保證尾幀單調遞增，最終段固定為 Panel 9。
  - [x] `validateSegments(segments)`：驗證段落物件之完整性。

---

## [TICKET-03] 提示詞生成與連續性強制注入器 (`promptBuilder.js`)
- **狀態**：`[COMPLETED]`
- **目標**：確保 AI 導演產出的每段 Prompt 具備嚴格首尾連貫語句與對白標籤。
- **實作模組**：`src/core/promptBuilder.js`
- **驗收準則 (Acceptance Criteria)**：
  - [x] `buildDirectorSystemPrompt(mode, sec)`：支援 `expand` 與 `auto` 兩種規劃模式。
  - [x] `ensureContinuityPrefix(index, prompt)`：第 2~$N$ 段強制注入 `"Create a 5-second live-action cinematic film continuing seamlessly from the exact last frame..."`。
  - [x] `wrapDialogueTag(text)` / `extractDialogueTags(text)`：標準化處理 `<d>[Chinese] ...</d>`。
  - [x] `cleanAndParseJson(raw)`：剝離 Markdown 代碼框並安全解析 JSON。

---

## [TICKET-04] ComfyUI Prompt API 節點圖生成器 (`comfyPayload.js`)
- **狀態**：`[COMPLETED]`
- **目標**：提供具備型態檢查與參數防呆的 ComfyUI API Graph JSON 生成函式。
- **實作模組**：`src/core/comfyPayload.js`
- **驗收準則 (Acceptance Criteria)**：
  - [x] 產出合法的節點圖（Node 3: `LoadImage`、Node 1: `H3ChainedStoryboardVideo`、Node 2: `SaveVideo`）。
  - [x] 支援畫質/速度設定覆寫（steps, layers, token_reduction 等）。
  - [x] 空檔名或空段落時主動丟出描述性 Error，防止發送無效請求。

---

## [TICKET-05] 網路請求與跨域 (CORS) 異常診斷器 (`cloudDiagnostics.js`)
- **狀態**：`[COMPLETED]`
- **目標**：取代瀏覽器原生模糊的 `TypeError: Failed to fetch`，提供繁體中文具體可執行的修復指引。
- **實作模組**：`src/core/cloudDiagnostics.js`
- **驗收準則 (Acceptance Criteria)**：
  - [x] 識別 Port 8188 連線失敗，提示執行 `一鍵啟動_H3分鏡工作坊.command` 與 `--enable-cors-header "*"`。
  - [x] 識別 API 401/403，提示至安全設定視窗檢查金鑰。
  - [x] 識別 API 429，提示冷卻重試或更換模型。

---

## [TICKET-06] 自動化單元測試回饋迴路 (`tests/core.test.js`)
- **狀態**：`[COMPLETED]`
- **目標**：建立零依賴的測試套件，保證未來重構或新增功能時具備即時回饋防護網。
- **實作檔案**：`tests/core.test.js`、`package.json`
- **驗收準則 (Acceptance Criteria)**：
  - [x] 使用 Node.js 26 內建 `node:test` 與 `node:assert/strict`。
  - [x] 包含 14 項測試用例，全數通過 (14/14 Passed)。
  - [x] 配置 `npm test` 命令，一鍵自動執行。

---

## [TICKET-07] 工作室主介面整合與雙模相容 (`H3_Storyboard_Studio.html`)
- **狀態**：`[COMPLETED]`
- **目標**：主網頁整合抽取後的模組，並兼顧本機檔案系統雙擊開啟（`file:///`）之可用性。
- **實作檔案**：`H3_Storyboard_Studio.html`
- **驗收準則 (Acceptance Criteria)**：
  - [x] 引入 `src/core/` 4 大模組，並保留安全降級預設邏輯。
  - [x] 步驟一、本地 ComfyUI 生成與雲端影片生成全面掛載 `H3CloudDiagnostics`。
  - [x] 主網頁 JavaScript 語法通過 Node.js 語法檢驗，無 Parse Error。
