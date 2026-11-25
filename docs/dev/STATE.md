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

## 3. Phase A 收斂修訂（A4-1 ～ A4-6 全部完成；Layer 2 遠端 CI 待推送驗證）
- [x] `A4-1` Fail-Closed Full Gate、本機 `:8080` 靜態服務與 `start_studio.sh` 自動建置、兩層 CI 納管（Layer 1 靜態 YAML/Job）
- [x] `A4-2` 修復 `saas_api`/`refImage` 回歸、Store 白名單型別與 `deepFreeze` 防護、45 處 Sink 脈絡分類防護與 CLI 收斂
- [x] `A4-3` 開啟 TS `strict: true`、集中常數、精簡 `windowBindings.ts`、強化架構測試並轉 `.mts` 靜音
- [x] `A4-4` 證據驅動重構 Batch 1（編導、分鏡、Colab、UI Shell：附四項設計卡與豁免紀錄）
- [x] `A4-5` 證據驅動重構 Batch 2（算力調度、播放器、音訊、工作區、監聽器與 `AudioContext` 釋放）
- [x] `A4-6` 完整 Fail-Closed Gate 驗收、Git Diff 範圍確認、Layer 2 遠端 CI（待推送驗證）與雙軸複驗 PASS 結案

## 4. Phase B：引擎擴充（Phase A 正式結案後方可啟動）
- [ ] `B0-SPEC` 契約先行（ADR-0003）：定義 `TimelineSpec`（Timebase/FPS/32kHz/同步）、分離 `VoiceProvider` 與 `ResourceScheduler`、鎖定 `HyperFrames`（Next Up）
- 後製合成層參考：[POST_PRODUCTION_HYPERFRAMES_PLAN.md](POST_PRODUCTION_HYPERFRAMES_PLAN.md)（待 Phase A 結案後啟動 `B0-SPEC`）。
