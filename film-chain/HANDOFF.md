# H3 Storyboard Studio — 開發交接文件 (HANDOFF.md)
*遵循 Matt Pocock `handoff` 規範：記錄系統目前狀態、已完成決策、架構拓撲與後續維護指引。*

---

## 1. 系統目前狀態 (Current Status)
- **架構升級**：已成功從 2,100 行單檔巨石程式碼，重構為具有領域規格、核心模組分離、與自動化測試保護的現代化架構。
- **測試狀態**：`npm test` 執行通過率 **100% (14/14 tests passed, 0 failures)**。
- **雙模可用性**：
  - 本地開發者 / CI 環境：可使用 Node.js 直接執行 `npm test`。
  - 一般使用者：雙擊 `一鍵啟動_H3分鏡工作坊.command` 即開即用，無需 npm build 或本機伺服器架設。

---

## 2. 檔案目錄結構 (Project Topology)
```text
MiniMax-H3-h3c-ComfyUI/
├── H3_Storyboard_Studio.html           # 前端視覺與互動主入口
├── 一鍵啟動_H3分鏡工作坊.command        # 本地雙擊一鍵自動啟動 ComfyUI + 打開網頁
├── package.json                        # 測試指令與專案中繼資料 (npm test)
├── GLOSSARY.md                         # 領域詞彙辭典 (Ubiquitous Language)
├── SPEC.md                             # 系統架構、API 合約與資料模型規格書
├── TICKETS.md                          # 工程實作工單與驗收紀錄
├── HANDOFF.md                          # 本交接文件
├── src/
│   └── core/
│       ├── timecodeHelper.js           # 時間軸、分段秒數與尾幀單調遞增推算
│       ├── promptBuilder.js            # 導演 System Prompt、連貫前綴與對白標籤
│       ├── comfyPayload.js             # ComfyUI /prompt 節點圖組裝與防呆驗證
│       └── cloudDiagnostics.js         # 網路、跨域 (CORS) 與金鑰錯誤繁中引導
└── tests/
    └── core.test.js                    # 零外部依賴之 Node 原生單元測試套件
```

---

## 3. 關鍵架構決策 (Key Architectural Decisions)
1. **封裝格式選用 UMD (Universal Module Definition)**：
   - 核心模組若使用 `import / export`（ESM），在使用者雙擊 HTML（`file:///` 協議）時會觸發瀏覽器的本地跨域安全性限制。
   - 採用 UMD 讓模組在 Node.js 中自動成為 CommonJS 模組（支援 `require` 測試），在瀏覽器中自動掛載至 `window.H3TimecodeHelper` 等命名空間，實現**零建置步驟、雙模通用**。
2. **測試框架選用 Node.js 26 原生 `node:test`**：
   - 避免引入 Jest / Vitest 等龐大的 `node_modules` 依賴庫，維持專案輕巧純淨。
3. **分鏡連續性強約束**：
   - 第 2 段以後的 Prompt 必須具備首尾連貫語句，並由 `promptBuilder` 在編排階段與手動編輯階段主動保護。

---

## 4. 維護與後續擴充指引
- 若需調整分鏡長度（例如支援 10 秒 chunk 或 3 秒 chunk）：修改 `src/core/timecodeHelper.js` 的 `SEGMENT_DURATION_SECONDS`，並執行 `npm test` 檢驗回歸。
- 若需增加新的雲端影片 API 提供商：在 `src/core/cloudDiagnostics.js` 補充該提供商的錯誤特徵，並於 `H3_Storyboard_Studio.html` 中的 `callCloudVideoSegment` 擴充端點調用。
