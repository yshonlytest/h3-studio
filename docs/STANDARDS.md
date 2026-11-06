# 工程規範（單一來源 SSOT）

> 其他文件（CONTRIBUTING、AGENTS、STATE）只連結本檔，不複製數值。
> 前端細則另見 [film-chain/CODING_STANDARDS.md](../film-chain/CODING_STANDARDS.md)（UMD、零建置、領域規則）。

## 量化紅線（Python 與 JS 共用）
| 項目 | 規則 | 執行方式 |
|---|---|---|
| 函式長度 | ≤ 50 行（以 `PLR0915` 的 50 個 statements 為代理指標） | CI 阻擋；舊檔案見 `pyproject.toml` baseline |
| 縮排層數 / 複雜度 | ≤ 3 層（以 `C901` ≤ 10 為代理指標） | CI 阻擋；同上 |
| 參數數量 | > 3 個須封裝（Python：`@dataclass(frozen=True)`） | CI `PLR0913` 阻擋；同上 |
| 例外處理 | 禁止空 `except: pass` / `catch {}`，須記錄結構化 Context | `ruff B/E` + Code Review |
| 魔術數字 | 集中於 `config` / 模組頂部常數 | Code Review |
| 新 Python 檔 | 須有 `from __future__ import annotations`，位置在**模組 docstring 之後、其他 import 之前**（放在 docstring 前會讓 docstring 失效並觸發 E402） | `ruff I/E402` |
| 本機路徑 | 禁止硬編碼 `/Users/...` | CI leak check |

## 測試
- Python：`python3 -m unittest discover -s tests`（以 CI 結果為準，不在文件寫死數量）。
- 前端：`cd film-chain && npm test`（Node 原生 `node:test`）。

## 文件規則
- `docs/dev/STATE.md` ≤ 50 行，覆寫更新、不追加敘事。
- 已完成階段移入 `docs/archive/`；決策理由寫入 `docs/adr/`。
- 文件中不寫會過期的數字（測試數、行數），改寫「如何查得」。
