# AGENTS.md — Coding Agent 接力守則（必讀）

**⚡ 給 3.8 Flash 模型的接力守則（必讀）**：
1. **禁止全檔讀取**：本專案 `film-chain/public/index.html` 長達 5189 行。**嚴禁整檔讀取**，請先 `grep` 定位，再只讀取目標前後切片（每次 $\le 100$ 行）。
2. **微批次執行與強制雙檔進度同步（Vertical Micro-Batching & Dual-File Doc Sync）**：
   - 任務總表見 `docs/dev/STATE.md`（嚴禁超過 50 行），細項執行手冊見 `docs/dev/V2_EXECUTION_PLAN.md`。
   - 每次只准做 **1 個子步驟（如 `F0-PRE` 或 `F1-1`）** $\to$ 用 `edit_file` **同步將 `docs/dev/STATE.md` 與 `docs/dev/V2_EXECUTION_PLAN.md` 該步驟的 `- [ ]` 改為 `- [x]`** $\to$ 執行該步驟附帶的 **驗證與文件打勾斷言指令（含 `grep -q "\- \[x\]"` 與行數檢查）** $\to$ 通過後才可進入下一步。嚴禁跳過文件更新！
3. **沙盒與 Python 規範（極重要避坑）**：
   - 語法檢查與純邏輯單元測試一律在標準沙盒執行：`/usr/bin/python3`（注意：macOS 系統 Python 為 3.9，所有新 Python 檔必須有 `from __future__ import annotations`（置於模組 docstring 之後、其他 import 之前；規範見 `docs/STANDARDS.md`））。
   - `film-chain/public/src/core/*.js` 子目錄在標準終端沙盒下會回報 `Operation not permitted`，因此對 `film-chain/` 下所有檔案請**一律使用原生 `read_file` 與 `edit_file` 工具讀寫**（`read_file` / `edit_file` 不受沙盒限制）。
   - 只有真正呼叫 `./h3` 進行 Metal GPU 算圖時，因 macOS Metal Shader 編譯需寫入 `/var/folders/.../com.apple.metalfe`，才設定 `BypassSandbox: true`。
4. **Martin Fowler 量化紅線**：單一函式 $\le 50$ 行、縮排 $\le 3$ 層、參數 $> 3$ 個時必須封裝為 `@dataclass(frozen=True)`、禁止空的 `except: pass`。
5. **算力調度、門禁與驗證鐵律**：
   - 唯一合法 CLI 入口為 `python3 -m pipeline.h3_cli`（禁裸調腳本或手寫 JSON）。
   - Colab GPU 執行必須經「`plan` (Dry Run) $\to$ 使用者確認 $\to$ `run --confirm-token`」兩階段門禁；嚴禁無授權降級或無限重試。
   - 影片產物未通過 `verify` 達 `ARTIFACT_VERIFIED`（含 `ffprobe` 與 SHA-256）前，嚴禁宣稱完成。詳細規格見 `docs/STANDARDS.md`。


