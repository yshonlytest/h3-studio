# STATE.md — 專案狀態索引（導航用，≤ 50 行，覆寫更新、不追加敘事）

> 守則見 [AGENTS.md](../../AGENTS.md)。本檔只回答「現在在哪、下一步是什麼、該讀什麼」。

## 目前階段
- P0–P6、Phase 1–11 全數完成（最後 commit：`e4dbb20` Web UI 雙模整合 + 本機 Metal Daemon）。
- 單元測試：34/34 通過（`python3 -m unittest discover -s tests`）。
- 進行中任務：**無**（文件與技術債整理中，見下方）。

## 下一個任務
- 文件債 / 技術債改善計畫（依序）：
  - [x] Step 1：拆分 STATE.md（本檔、AGENTS.md、docs/ref、docs/archive）
  - [x] Step 2：規範單一來源 `docs/STANDARDS.md`（CONTRIBUTING 已改為連結）
  - [x] Step 2b：`film-chain/HANDOFF.md`、`CODING_STANDARDS.md` 路徑與入口檔名已更新
  - [x] Step 2c：`film-chain/SPEC.md` 已對照 `comfyPayload.js` / `h3_presets.py` / `h3_server.py` 更新（TICKETS.md 後半尚未核對）
  - [x] Step 3：CI 閘門已轉阻擋（pyproject.toml baseline 初期 6 檔；ruff check . 全綠、34 測試通過）
  - [ ] Step 3b：逐步縮減 baseline（已拔除 `h3_prompt_linter.py`，剩餘 5 檔；集中於 `h3_storyboard_pipeline.py`、`comfy_h3_bridge/__init__.py`）
  - [x] Step 4：`docs/adr/`（範本 + ADR-0001）與 `docs/templates/REVIEW_FINDINGS.md`；下次 Code Review 起使用
  - [ ] Step 5：架構債排程（`film-chain/public/index.html` 5189 行拆分、`h3.c` 雙來源釐清）

## 已知問題 / 架構債
- `film-chain/public/index.html` 約 5189 行單體檔案（須切片讀取）。
- 引擎來源重複：`engines/h3.c` 與 `MiniMax-H3-h3c-ComfyUI/h3.c`。
- CONTRIBUTING.md 與 AGENTS.md 的規範數值不一致（Step 2 處理）。

## 待決策
- JS（`comfyPayload.js`：640×480、16 步、45 層）與 CLI turbo（864×480、6 步、50 層）預設不一致，是否統一？（見 SPEC §2.1.1）

## 文件地圖（依任務選讀）
| 層級 | 文件 | 何時讀 |
|---|---|---|
| L1 必讀 | [AGENTS.md](../../AGENTS.md)、本檔 | 每個任務 |
| L1 | [README.md](../../README.md)、[CONTRIBUTING.md](../../CONTRIBUTING.md) | 需要使用方式 / 貢獻流程 |
| L2 | [docs/ref/HARDWARE_AND_ENGINE.md](../ref/HARDWARE_AND_ENGINE.md) | 動到引擎、預設值、記憶體、模型權重 |
| L2 | [docs/H3_WORKFLOW_OPTIMIZATION_RESEARCH.md](../H3_WORKFLOW_OPTIMIZATION_RESEARCH.md) | 調整工作流設計 |
| L3 | [docs/archive/STATE_HISTORY.md](../archive/STATE_HISTORY.md) | 追查過去某階段為何這樣做 |
| L3 | `docs/adr/`（建立中） | 追查架構決策理由 |
