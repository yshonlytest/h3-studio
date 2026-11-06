# ADR-0001：CI 複雜度閘門採 baseline 放行，並修正 future import 位置規則

- 狀態：已接受
- 日期：2026-11-06
- 決策者：使用者 + 開發 Agent

## 背景
量化紅線（函式長度、參數數）只寫在文件、CI 為 advisory（`|| true`）。原規範「future import 放第 1 行」造成 54 個 E402，且使 docstring 失效。

## 決策
- `pyproject.toml` 將 C901/PLR0912/PLR0913/PLR0915 設為阻擋，舊違規 6 檔以 `per-file-ignores` 明列。
- future import 改放 docstring 之後、其他 import 之前。

## 理由與否決選項
- 理由：新程式碼立即受規範約束，舊債可逐步償還而不阻塞開發。
- 否決：一次重構全部舊檔 — 風險高、與功能開發混雜。
- 否決：維持 advisory — 規範靠 Agent 自律，已證實無效。

## 影響
baseline 清單只能縮減（STATE.md Step 3b）；見 docs/STANDARDS.md。
