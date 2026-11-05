# 專案工程編碼規範 (CODING_STANDARDS.md)
*作為 AI Code Review / Standards Axis 審查之基準規範文件*

本文件定義本專案的程式碼撰寫標準、架構守則與代碼壞味道（Code Smells）防範準則。

---

## 1. 架構原則 (Architecture Principles)

### 1.1 純邏輯與副作用解耦
- 所有核心計算（時間軸切分、Prompt 組裝、ComfyUI 節點生成、錯誤診斷）必須置於 `src/core/` 且為**無狀態純函數 (Pure Functions)**。
- 前端 DOM 操作、瀏覽器事件監聽、Canvas 繪圖等副作用代碼一律限制在 `H3_Storyboard_Studio.html` 或專案外層腳本中，嚴禁侵入 `src/core/`。

### 1.2 UMD 雙模相容性規範 (Dual-Mode Compatibility)
- `src/core/` 下的所有模組必須使用 UMD (Universal Module Definition) 樣板：
  ```javascript
  (function (root, factory) {
    if (typeof module === 'object' && module.exports) {
      module.exports = factory();
    } else {
      root.MyModule = factory();
    }
  }(typeof self !== 'undefined' ? self : this, function () {
    return { ... };
  }));
  ```
- **禁止**在核心模組使用原生 ESM `import / export` 語法，以確保一般使用者雙擊 HTML (`file:///`) 即可運作，同時開發者可使用 Node.js 執行單元測試。

### 1.3 零建置與測試守則 (Zero-Build & Testing)
- 單元測試置於 `tests/`，強制使用 Node 原生模組 `node:test` 與 `node:assert`。
- 新增模組或修改核心邏輯時，必須附帶對應的單元測試，並確保 `npm test` 通過率 100%。

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
