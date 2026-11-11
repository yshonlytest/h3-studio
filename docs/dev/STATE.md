# STATE.md — 專案狀態索引與 3.8 Flash 單向微批次清單

> 守則見 [AGENTS.md](../../AGENTS.md)、規範見 [docs/STANDARDS.md](../STANDARDS.md)、細項步驟見 [V2_EXECUTION_PLAN.md](V2_EXECUTION_PLAN.md)。
> **⚡ 3.8 Flash 鐵律：每完成 1 個子步驟（如 `F0-PRE` 或 `F1-1`），必須在同一個回合用 `edit_file` 同步把本檔（`STATE.md`）與 `V2_EXECUTION_PLAN.md` 對應的 `[ ]` 改為 `[x]`，並通過下方驗證指令；禁止跳步、禁止追加長篇敘事（本檔嚴禁超過 50 行）。**

## 1. 已完成階段（M1~M7, U1~U4, C1~C7, D1~D4, E1~E6, F0）
- 資產四層隔離、雙範式、本地環境中樞 HUD、2×3 雙軸閘道、F0 實驗報告（[F0_AUDIO_AND_ALIGNMENT_REPORT.md](F0_AUDIO_AND_ALIGNMENT_REPORT.md)）已驗收。

## 2. V2 微批次進度表（每步完成後必須同步將 `[ ]` 改為 `[x]` 並執行獨立 `git commit`）
- [x] `F0-1` H3 `256×160` 代理畫布物理耗時與聲紋實測（127.2s，快 13.9 倍）
- [x] `F0-2` H3 代理音軌 vs 獨立 TTS 量化對比（相似度 0.971 vs 0.303）
- [x] `F0-3` 中文 Character-Level 時間戳與 VAD 能量包絡對齊實測
- [x] `F0-BRANCH` 建立並切換至開發分支 `feat/v2-architecture-upgrade`
- [x] `F0-PRE` 修復既有環境斷點（對齊 `resolve_checkpoint_dir` 與統一測試執行器）
- [x] `F1-1` 於 `pipeline/h3_state.py` 實作環境指紋與五節點 `ShotArtifactHashes`
- [x] `F1-2` 實作快取失效判定器 `evaluate_shot_invalidation` 與 8 情境測試
- [x] `F1-3` 將分層 Hash 接入 `pipeline/h3_storyboard_pipeline.py`
- [x] `F2-1` 建立受控三層發音正規化器 `pipeline/h3_phonetic_normalizer.py`
- [x] `F2-2` 接入 `pipeline/h3_edu_profile.py` 雙軌欄位並維持舊版相容
- [x] `F3-A1` CJK 字體 `getmask` 實測載入驗證與動態畫布排版
- [x] `F3-A2` 中文 Character-Level 時間戳與兩階段語音對齊引擎
- [x] `F3-B` 音視訊時長差 `apad` 安全檢查與 `mov_text` 軟/硬字幕封裝
- [x] `F4-1` 建立數據可信度分級之 `pipeline/h3_telemetry.py`
- [ ] `F4-2` 收編通用化五態 `pipeline/h3_colab_watchdog.py`（含 `STALLED` 偵測）
- [ ] `F5-1` 實作 `pipeline/h3_cli.py`：Manifest 驗證、表格編譯與語意切片 `digest`
- [ ] `F5-2` 實作 `resolve-anchor` 四級防呆梯、`render-slide` 與更新 `SKILL.md`
- [ ] `F6-A1` 抽離 `index.html` 內嵌 CSS 與靜態長篇 Prompt（100% 保留閘道 DOM）
- [ ] `F6-A2` 漸進抽離 Step 5 音軌字幕控制器與新增 `dom_integrity.test.js`
- [ ] `F7-A1` 實作 `pipeline/h3_job_manager.py`：Job Lifecycle、`ShotLock`、Journal Commit 與異常恢復
- [ ] `F7-A2` 於 `pipeline/h3_server.py` 接入安全沙盒 API：`/api/workspace-sync` 與 `/api/reroll-shot`
- [ ] `F7-B` 實作 `workspaceSync.js` 串接步驟一～五閘道與鎖定狀態 UI
- [ ] `F8-1` 實作極速代理音訊重抽器 `h3_audio_reroller.py` 與 8 步跨批次快取失效整合測試
- [ ] `F9-1` 於 `h3_edu_profile.py` 與 `h3_cli.py` 新增獨立 `colab_12s` 雙圖高吞吐規格
