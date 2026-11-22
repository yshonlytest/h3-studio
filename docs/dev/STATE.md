# STATE.md — 專案狀態索引與 3.8 Flash 單向微批次清單

> 守則見 [AGENTS.md](../../AGENTS.md)、規範見 [docs/STANDARDS.md](../STANDARDS.md)、細項步驟見 [V2_EXECUTION_PLAN.md](V2_EXECUTION_PLAN.md)。
> **⚡ 3.8 Flash 鐵律：每完成 1 個子步驟，必須在同一個回合用 `edit_file` 同步把本檔與 `V2_EXECUTION_PLAN.md` 對應的 `[ ]` 改為 `[x]`，並通過驗證指令；本檔嚴禁超過 50 行。**

## 1. 已完成階段（M1~M7, U1~U4, C1~C7, D1~D4, E1~E6, F0~F9）
- F0~F9 微批次完整驗收紀錄見 [archive/V2_F0_F9_COMPLETED.md](archive/V2_F0_F9_COMPLETED.md)。

## 2. F10 微批次進度表（算力調用、狀態持久化、教學範本落地與 Code Review）
- [x] `F10-PRE` F0～F9 歷史無損歸檔與 F10 原子微批次清單掛載
- [x] `F10-1A` 於 `pipeline/h3_state.py` 實作七態狀態機、錯誤細分碼與跨 Session 持久化查詢
- [x] `F10-1B` 實作產物深度驗證器 `pipeline/h3_verifier.py`（ffprobe + SHA-256）
- [x] `F10-2A` 實作 Schema v2 角色感知轉接器 `pipeline/h3_manifest_adapter.py`
- [x] `F10-2B` 擴充 `pipeline/h3_colab_watchdog.py` 四階段感知與進程清理
- [x] `F10-3A` 實作兩階段授權門禁調度器 `pipeline/h3_dispatcher.py`
- [x] `F10-3B` 重構 `pipeline/h3_cli.py` 表驅動路由並接入算力調度子命令
- [x] `F10-4` 路線正名（saas_api）與前端雙向向下相容
- [x] `F10-5` Skill Discovery 雙平台實證與專案 Skill 統一導向
- [x] `F10-6A` H3 實測教學成片與完整分鏡範本全鏈路落地
- [x] `F10-6B` 規範落地與執行 `/code-review` 總驗收

## 3. F11 微批次進度表（UX 改善、動線收斂與資料交接可靠性）
- [x] `F11-0` UX 現況盤點、User Journey 拆解與 P0~P3 問題分級
- [x] `F11-1` Web 操作動線與已知 Bug 修復（移除步驟一錯置藍框、唯一 ID、秒數檔名、步驟三下載入口）
- [x] `F11-1-FIX` 修復 Edu 幀數桶秒數累積偏差 (105s)、補齊 jobs 參考圖與消除 Adapter 短路
- [x] `F11-2` Web / Agent / CLI 資料交接可靠性
- [x] `F11-3` Prompt 生成邏輯與 `h3_cli` 整合
- [x] `F11-4` Agent-First 快速體驗入口
- [x] `F11-5` 統一 Skill 與授權引導
- [x] `F11-FIX` 跨工作流整合缺陷收斂（DOM 遞迴、Inline 碰撞、缺圖、Hybrid 無損、Worker 鎖與 OAuth 門禁）

## 4. 後製合成層（選配）規劃
- 借鏡 heygen-com/hyperframes：詳見 [POST_PRODUCTION_HYPERFRAMES_PLAN.md](POST_PRODUCTION_HYPERFRAMES_PLAN.md)（H0~H6 微批次：ADR → 宣告式時間軸 → lint → headless check → 確定性 render → 教學樣板 → CLI 整併）。
- 邊界：不取代 `h3.c`／Colab 生成管線；純串接＋靜態字幕維持 FFmpeg 快速路徑，合成層僅在圖表／程式碼高亮／動態字卡需求時啟用。
