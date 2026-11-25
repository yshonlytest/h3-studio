# 專案工程編碼規範 (CODING_STANDARDS.md)
*作為 AI Code Review / Standards Axis 審查之基準規範文件*

本文件定義本專案的程式碼撰寫標準、架構守則與代碼壞味道（Code Smells）防範準則。

---

## 1. 架構原則 (Architecture Principles)

### 1.1 純邏輯、狀態與副作用分層
- 所有跨環境共用純計算（時間軸切分、Prompt 組裝、ComfyUI 節點生成、錯誤診斷）置於 `public/src/core/`，維持**無狀態純函數 (Pure Functions)**。
- 領域狀態與業務控制器置於 `client/`（TypeScript），依單向依賴原則組織：`features/* -> stores/* -> types/* / data/*`；禁止 `stores/` 或 `data/` 反向依賴 `features/`，亦禁止跨 Store 未受控寫入。
- 前端 DOM 操作、瀏覽器事件監聽、Canvas 繪圖等副作用代碼限制在 `client/features/*`、`client/bootstrap.ts` 與 `public/h3ServeBridge.js`，嚴禁侵入 `public/src/core/`。
- 量化紅線（函式長度、參數數量等）以 [docs/STANDARDS.md](../docs/STANDARDS.md) 為單一來源。

### 1.2 雙軌模組規範（Core UMD + Client TypeScript/ESM）
- `public/src/core/*.js` 保留 UMD (Universal Module Definition) 樣板，確保現有 CommonJS 單元測試零修改執行，同時可供瀏覽器與 `client/` 呼叫。
- UI 控制器、Store 與擴充契約一律使用 `film-chain/client/**/*.ts`（標準 ES Modules + TypeScript，避免 TS `enum` / `namespace` 以相容 Node 原生 TypeScript 執行），經 Vite (`publicDir: false`, `build.outDir: "public/dist"`) 編譯為 `public/dist/studio.js` 供 Cloudflare Workers 與本機環境使用。

### 1.3 建置與測試守則 (Vite Build & Native `node:test`)
- 單元測試置於 `tests/`，強制使用 Node 原生模組 `node:test` 與 `node:assert`（同時支援 CommonJS `.test.js` 與原生 TypeScript `.test.ts`）。
- 變更前端程式碼後，必須確保 `npm run typecheck` 與 `npm test`（含 `pretest` 自动執行 `vite build`）通過率 100%。

---

## 2. 程式碼品質與壞味道防範 (Code Smells Prevention)

遵循 Martin Fowler 重構守則，嚴格審查以下模式：

1. **基本型別偏執 (Primitive Obsession)**：
   - 避免直接傳遞雜亂的未驗證字串或數值。涉及關鍵領域模型（如 `StoryboardPlan`、`StoryboardSegment`）時，必須先經過型別與結構驗證函式（如 `validateSegments`）。
2. **依戀情節 (Feature Envy)**：
   - 模組內部函式不得頻繁存取其他模組私有細節。計算邏輯屬於誰，就必須收斂在該模組內。
3. **散彈式修改 (Shotgun Surgery)**：
   - 時間參數（如 `SEGMENT_DURATION_SECONDS = 5`）、預設節點 ID 等關鍵常數必須集中定義在模組頂部，不得散落硬編碼（Hardcoded）在各處。
4. **巨石函式 (Long Method)**：
   - 單一函式邏輯若超過 50 行，必須拆分為語意明確的私有輔助函式。
5. **吞噬異常 (Swallowed Errors)**：
   - 嚴格禁止空的 `catch (e) {}`。所有捕捉到的錯誤若無法就地恢復，必須拋出具體描述或經由 `cloudDiagnostics` 轉換為對使用者友善的繁體中文修復建議。

---

## 3. 領域特定守則 (Domain Specific Rules)
- **連貫前綴**：第 2 段起的影片分鏡 Prompt，必須包含官方連貫前綴 `"Create a 5-second live-action cinematic film continuing seamlessly from the exact last frame..."`。
- **對白格式**：口白必須使用 `<d>[Chinese] ...</d>` 標籤，並維持時間軸標註一致性。
