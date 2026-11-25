# STATE.md — 專案狀態索引與微批次執行清單

> 守則見 [AGENTS.md](../../AGENTS.md)、規範見 [docs/STANDARDS.md](../STANDARDS.md)、細項步驟見 [V2_EXECUTION_PLAN.md](V2_EXECUTION_PLAN.md)、決策見 [ADR-0002](../adr/0002-frontend-modularization-and-domain-stores.md)。
> **⚡ 鐵律：每完成 1 個子步驟，必須在同回合用 `edit_file` 同步把本檔與 `V2_EXECUTION_PLAN.md` 對應 `[ ]` 改為 `[x]`，並通過驗證；本檔嚴禁超過 50 行。**

## 1. 已完成歷史階段（F0～F11）
- F0～F9 歸檔：[archive/V2_F0_F9_COMPLETED.md](archive/V2_F0_F9_COMPLETED.md)｜F10～F11 歸檔：[archive/V2_F10_F11_COMPLETED.md](archive/V2_F10_F11_COMPLETED.md)

## 2. Phase A：前端架構債務清理與模組化（已完成結案，本機 Gate 與雙軸複驗 PASS）
- [x] `A0-PRE` 歸檔 F10～F11、立案 `ADR-0002`、更新規範並掛載 Phase A 清單
- [x] `A1-1` 建立 Vite + TypeScript 建置管線、類型地基與修正 `#lexiconModal` DOM 順序
- [x] `A1-2` 抽離 `DEMO_PROJECT_CONFIG`、`SPEED_CONFIGS` 與 `GOLDEN_TEMPLATES_FALLBACK` 至 `client/data/templates.ts`
- [x] `A2-1` 建立 Store 工廠、`coreStore` 與 `storyboardStore` 及單元測試
- [x] `A2-2` 建立 `computeStore` 與 `audioSubtitleStore`（清除所有頂層全域 `let`）
- [x] `A3-1` 垂直拆分 UI Shell 與 Colab Session Relay（`uiShell.ts` + `sessionColab.ts`，清除死碼複本）
- [x] `A3-2` 垂直拆分 Step 1 編導、單格精修與 Doc-to-Edu（`director.ts` + `panelRefiner.ts` + `eduStudio.ts`）
- [x] `A3-3` 垂直拆分 Step 2 分鏡、2D 運鏡畫布與破音字詞庫（`stagingCanvas.ts` + `storyboardEditor.ts` + `phoneticsLexicon.ts`）
- [x] `A3-4` 垂直拆分 Step 3～5、Workspace 與 Bootstrap，達成 `index.html` 零內嵌 `<script>`
- [x] `A3-5` 架構契約初版測試建立（原全倉 Gate 因 `.pyc` 失敗且僅補跑部分檢查，最終全倉驗收併入 `A4-6`）

## 3. Phase A 收斂修訂（A4-1 ～ A4-6 完成，已推送並通過遠端 CI）
- [x] `A4-1` ～ `A4-6` 嚴格 TS、Store 不可變防禦、重構設計卡、資源釋放、Fail-Closed Full Gate 與 Layer 2 遠端 CI 全綠結案

## 4. UI/UX 精修（U0～U3：規則一致性 → 漸進式揭露 → 狀態回饋）
- [x] `U0-DOCS` 更新 [AGENTS.md](../../AGENTS.md) 反映 `client/` TypeScript + Vite 架構、`dist/` 禁止手改與本機啟動驗證指令
- [x] `U1-CONSISTENCY` 建立 `execution_rules.json` / `executionRules.ts` SSOT、移除無授權 GPU 降級承諾、統一品牌與 `h3ServeBridge.js` Prompt
- [ ] `U2-IA-WORKFLOW` 首屏漸進式揭露（安全提示／模式說明／路線詳情）與 Web-First / Agent-First 雙工作介面分級（Next Up）
- [ ] `U3-FEEDBACK` 範例動態摘要、資料驅動 5 階段進度列（`deriveWorkflowProgress`）與渲染前授權成本摘要

## 5. Phase B：引擎擴充（UI/UX 精修完成後方可啟動）
- [ ] `B0-SPEC` 契約先行（ADR-0003）：定義 `TimelineSpec`（Timebase/FPS/32kHz/同步）、分離 `VoiceProvider` 與 `ResourceScheduler`、鎖定 `HyperFrames`
- 後製合成層參考：[POST_PRODUCTION_HYPERFRAMES_PLAN.md](POST_PRODUCTION_HYPERFRAMES_PLAN.md)（待 `U3` 結案後啟動 `B0-SPEC`）。
