# ADR-0002：前端模組化（Vite + TypeScript）、領域分治 Store 與兩階段隔離

- 狀態：已接受
- 日期：2026-11-24
- 決策者：使用者 + Orchestrator / Execution Agent

## 背景
`film-chain/public/index.html` 已膨脹至 7,387 行，單一內嵌 `<script>` 含 32 個全域 `let`（加上 `studioAudioSubtitles.js` 共 39 個）、177 個頂層函式與 169 個內聯 DOM 事件，導致上下游依賴耦合與重複函式宣告（如 `saveCloudDirectKey` / `onCloudProviderChange`）。既有 `file:///` 零建置與禁用 ESM 規範阻礙了安全拆分，且無法乾淨承接後續 Qwen3-TTS 與 HyperFrames 擴充。

## 決策
- **退役 `file:///` 零建置束縛（UI 層）**：正式部署為 Cloudflare Workers 靜態資產與本機 `:8080` Daemon；`public/src/core/*.js` 暫維持 UMD 以相容現有 CommonJS 測試，UI 控制器與狀態改以 `film-chain/client/**/*.ts` 開發，透過 Vite（`publicDir: false`、`build.lib` IIFE 輸出 `public/dist/studio.js`）編譯。
- **領域分治 Store（Domain Stores）**：將 39 個可變全域狀態按所有權拆入 4 個獨立 Store（`coreStore`、`storyboardStore`、`computeStore`、`audioSubtitleStore`），強制單向依賴（`features -> stores -> types/data`），禁止建立單一巨型全域 Store。
- **兩階段嚴格隔離**：Phase A 僅償還架構債（100% 保留既有 UI 與行為，零新能力注入）；Phase A 全數通過驗收後，方進入 Phase B（`TimelineSpec`、Qwen3-TTS Sidecar、HyperFrames Compositor）。

## 理由與否決選項
- 理由：先透過 Vite + TS 與 Domain Stores 建立清晰模組邊界與自動化架構測試，能避免重構與新引擎介面設計互相污染。
- 否決：直接導入 React / Preact 重寫 UI — 會引入大量 DOM/Lifecycle 改寫與高度回歸風險。
- 否決：維持傳統全域 `<script>` 堆疊或單一 `StudioStore` — 無法解決命名空間污染與跨領域寫入耦合。

## 影響
- 更新 [film-chain/CODING_STANDARDS.md](../../film-chain/CODING_STANDARDS.md) 第 1 節規範。
- [docs/dev/STATE.md](../dev/STATE.md) 與 [docs/dev/V2_EXECUTION_PLAN.md](../dev/V2_EXECUTION_PLAN.md) 掛載 Phase A 微批次（`A0-PRE` ～ `A3-5`）。
- Cloudflare Wrangler 透過 `film-chain/public/.assetsignore` 納管編譯產物並排除 `.map` 檔，Node `v26.7.0` 原生 TypeScript stripping 支援 `.test.ts` 與現有 `.test.js` 共存。

## 修訂補充（2026-11-25 — A4 收斂標準與 Phase B 契約邊界）
- **本機 `:8080` Daemon 靜態服務與建置閉環（`A4-1`）**：為落實退役 `file:///` 之決定，`pipeline/h3_server.py` 必須於 `:8080` 提供 `film-chain/public/` 唯讀靜態資產（含路徑穿越防護），且 `scripts/start_studio.sh` 需於啟動前建置 `public/dist/studio.js` 並開啟 `http://127.0.0.1:8080/`；CI 採**兩層驗證**（Layer 1 本機靜態 YAML/Job 檢驗；Layer 2 遠端實際執行驗證）。
- **Full Gate Fail-Closed 與測試基準（`A4-1` ～ `A4-6`）**：Full Gate 強制 `set -Eeuo pipefail` 避免 `| tee` 吞掉錯誤碼；Node（`MIN >= 74`）與 Python（`MIN >= 124`）摘要解析採 Fail-Closed（格式未知或摘要缺失一律 FAIL）；Path Hygiene 嚴格三態判定（僅 `rc == 1` PASS）。
- **Store State 型別限制與脈絡化 Sink 防護（`A4-2`）**：Domain Data State 僅允許 Primitive、Plain Object 與 Array，於開發／測試模式明確拒絕 `Map` / `Set` / `Date` / `RegExp` 等不可經 `Object.freeze()` 凍結之內建物件，瀏覽器 Runtime Handle 隔離於顯式白名單；45 處動態 HTML Sink 須依資料來源與 DOM API 脈絡逐一分類處置（`textContent` / `.value` / URL 白名單 / HTML 轉義），禁止一律套用 `escapeHtml()`。
- **證據驅動之複雜度治理與 Pragmatic 結案（`A4-3` ～ `A4-6`）**：`50 行 / 3 層縮排 / 3 參數` 僅作為 Review 警示門檻；每次重構須附 4 項設計卡，單一清晰職責函式可註記豁免；架構測試僅防止架構退化；A4 以「功能正確、邊界清晰、部署可重現、品質可自動驗證、具備 Phase B 契約」為結案終點。
- **Phase B 契約先行分工（`B0-SPEC`）**：`VoiceProvider` 僅封裝能力查詢／Profile／合成契約；Apple Silicon 記憶體互斥、載入卸載與排隊由獨立的 `ResourceScheduler` 管理；`TimelineSpec` 須在實作前明定 Timebase、Frame Rate（`24 fps` 基準）、Audio Sample Rate（`32000 Hz` 基準與重取樣規範）及音畫同步規則。
