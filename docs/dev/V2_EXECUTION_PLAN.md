# H3C Phase A 執行計劃：前端架構債務清理與收斂驗收（`A0-PRE` ～ `A4-6`）

> **歷史歸檔**：F0～F9 見 [archive/V2_F0_F9_COMPLETED.md](archive/V2_F0_F9_COMPLETED.md)；F10～F11 見 [archive/V2_F10_F11_COMPLETED.md](archive/V2_F10_F11_COMPLETED.md)。
> **現況判定**：Phase A 拆分實作（`A0-PRE` ～ `A3-5`）基本完成，進入 **階段 A4（`A4-1` ～ `A4-6`）收斂與最終 Gate 確認**；Phase A 正式結案後方可開啟 **Phase B（`B0-SPEC`）**。
> **架構決策**：見 [ADR-0002](../adr/0002-frontend-modularization-and-domain-stores.md)；**後製擴充（Phase B）**：見 [POST_PRODUCTION_HYPERFRAMES_PLAN.md](POST_PRODUCTION_HYPERFRAMES_PLAN.md)。
> **⚡ 執行鐵律**：
> 1. 禁止整檔讀取 `>200` 行檔案；必先 `grep -n` 或 Python 行號定位再切片讀取（`<=100` 行）。
> 2. `film-chain/` 下所有檔案一律使用原生 `read_file` / `write_file` / `edit_file` 工具。
> 3. 嚴格單批推進、零平行子代理、零行為變更（`A4` 不加入任何 Phase B 新能力）。
> 4. 每完成 1 個微批次，立即同步更新 `docs/dev/STATE.md`（`<= 50` 行）與本檔 `[ ]` $\to$ `[x]` 並執行對應完整驗收。

---

## 階段 A0：依賴盤點、歷史歸檔與架構立案

- [x] `A0-PRE` **歸檔 F10～F11、立案 `ADR-0002`、更新規範並掛載 Phase A 清單**
  - **產出與修改**：`docs/dev/archive/V2_F10_F11_COMPLETED.md`、`docs/adr/0002-frontend-modularization-and-domain-stores.md`、`film-chain/CODING_STANDARDS.md`、`docs/dev/STATE.md`、`docs/dev/V2_EXECUTION_PLAN.md`。
  - **🔍 驗證指令**：
    `test -f docs/adr/0002-frontend-modularization-and-domain-stores.md && test -f docs/dev/archive/V2_F10_F11_COMPLETED.md && grep -q "\- \[x\] \`A0-PRE\`" docs/dev/STATE.md && grep -q "\- \[x\] \`A0-PRE\`" docs/dev/V2_EXECUTION_PLAN.md && test $(wc -l < docs/dev/STATE.md) -le 50`

---

## 階段 A1：現代化建置地基與靜態資料抽離

- [x] `A1-1` **建立 Vite + TypeScript 建置管線、類型地基與修正 `#lexiconModal` DOM 順序**
  - **程式碼檔案**：`film-chain/package.json`、`film-chain/tsconfig.json`、`film-chain/vite.config.ts`、`film-chain/public/.assetsignore`、`film-chain/client/types/studio.ts`、`film-chain/client/main.ts`、`film-chain/public/index.html`。
  - **重點規範**：`vite.config.ts` 設 `publicDir: false`、`build.outDir: "public/dist"` 與 `formats: ["iife"]` (`studio.js`)；不加 `"type": "module"` 到 `package.json`；將 `#lexiconModal` 移至 `</dialog>` 之後；插入 `<script src="dist/studio.js"></script>`。
  - **🔍 驗證指令**：
    `npm run typecheck --prefix film-chain && npm test --prefix film-chain && test -f film-chain/public/dist/studio.js && grep -q "\- \[x\] \`A1-1\`" docs/dev/STATE.md && grep -q "\- \[x\] \`A1-1\`" docs/dev/V2_EXECUTION_PLAN.md && test $(wc -l < docs/dev/STATE.md) -le 50`

- [x] `A1-2` **抽離 `DEMO_PROJECT_CONFIG`、`SPEED_CONFIGS` 與 `GOLDEN_TEMPLATES_FALLBACK` 至 `client/data/templates.ts`**
  - **程式碼檔案**：新增 `film-chain/client/data/templates.ts`、新增 `film-chain/client/registry/windowBindings.ts`、更新 `film-chain/client/main.ts`、`film-chain/public/index.html`、`film-chain/tests/dom_integrity.test.js`。
  - **重點規範**：100% 無損搬移資料物件與 `createGoldenProjectObject`；擴充 `dom_integrity.test.js` 遞迴掃描 `client/**/*.ts`。
  - **🔍 驗證指令**：
    `npm run typecheck --prefix film-chain && npm test --prefix film-chain && grep -q "\- \[x\] \`A1-2\`" docs/dev/STATE.md && grep -q "\- \[x\] \`A1-2\`" docs/dev/V2_EXECUTION_PLAN.md && test $(wc -l < docs/dev/STATE.md) -le 50`

---

## 階段 A2：領域分治 Store 解耦（消滅 39 個全域可變狀態）

- [x] `A2-1` **建立 Store 工廠、`coreStore` 與 `storyboardStore` 及單元測試**
  - **程式碼檔案**：新增 `film-chain/client/stores/createStore.ts`、`coreStore.ts`、`storyboardStore.ts`、`legacyGlobalBridge.ts`、`tests/stores.test.ts`；修改 `client/main.ts`、`public/index.html`、`package.json`。
  - **🔍 驗證指令**：
    `npm run typecheck --prefix film-chain && npm test --prefix film-chain && grep -q "\- \[x\] \`A2-1\`" docs/dev/STATE.md && grep -q "\- \[x\] \`A2-1\`" docs/dev/V2_EXECUTION_PLAN.md && test $(wc -l < docs/dev/STATE.md) -le 50`

- [x] `A2-2` **建立 `computeStore` 與 `audioSubtitleStore`（清除所有頂層全域 `let`）**
  - **程式碼檔案**：新增 `film-chain/client/stores/computeStore.ts`、`audioSubtitleStore.ts`；更新 `legacyGlobalBridge.ts`、`client/main.ts`、`tests/stores.test.ts`、`public/index.html`、`public/src/controllers/studioAudioSubtitles.js`。
  - **🔍 驗證指令**：
    `npm run typecheck --prefix film-chain && npm test --prefix film-chain && ! grep -q "^    let " film-chain/public/index.html && grep -q "\- \[x\] \`A2-2\`" docs/dev/STATE.md && grep -q "\- \[x\] \`A2-2\`" docs/dev/V2_EXECUTION_PLAN.md && test $(wc -l < docs/dev/STATE.md) -le 50`

---

## 階段 A3：垂直功能拆分與全倉回歸總驗收

- [x] `A3-1` **垂直拆分 UI Shell 與 Colab Session Relay（`uiShell.ts` + `sessionColab.ts`，清除死碼複本）**
  - **程式碼檔案**：新增 `film-chain/client/features/uiShell.ts`、`sessionColab.ts`；更新 `windowBindings.ts`、`main.ts`、`public/index.html`。
  - **重點規範**：刪除早先遭覆寫的死碼複本 `saveCloudDirectKey` / `onCloudProviderChange`（保留 Step 3B 正本）。
  - **🔍 驗證指令**：
    `npm run typecheck --prefix film-chain && npm test --prefix film-chain && grep -q "\- \[x\] \`A3-1\`" docs/dev/STATE.md && grep -q "\- \[x\] \`A3-1\`" docs/dev/V2_EXECUTION_PLAN.md && test $(wc -l < docs/dev/STATE.md) -le 50`

- [x] `A3-2` **垂直拆分 Step 1 編導、單格精修與 Doc-to-Edu（`director.ts` + `panelRefiner.ts` + `eduStudio.ts`）**
  - **程式碼檔案**：新增 `film-chain/client/features/director.ts`、`panelRefiner.ts`、`eduStudio.ts`；更新 `windowBindings.ts`、`public/index.html`。
  - **🔍 驗證指令**：
    `npm run typecheck --prefix film-chain && npm test --prefix film-chain && grep -q "\- \[x\] \`A3-2\`" docs/dev/STATE.md && grep -q "\- \[x\] \`A3-2\`" docs/dev/V2_EXECUTION_PLAN.md && test $(wc -l < docs/dev/STATE.md) -le 50`

- [x] `A3-3` **垂直拆分 Step 2 分鏡、2D 運鏡畫布與破音字詞庫（`stagingCanvas.ts` + `storyboardEditor.ts` + `phoneticsLexicon.ts`）**
  - **程式碼檔案**：新增 `film-chain/client/features/stagingCanvas.ts`、`storyboardEditor.ts`、`phoneticsLexicon.ts`；更新 `windowBindings.ts`、`public/index.html`。
  - **🔍 驗證指令**：
    `npm run typecheck --prefix film-chain && npm test --prefix film-chain && grep -q "\- \[x\] \`A3-3\`" docs/dev/STATE.md && grep -q "\- \[x\] \`A3-3\`" docs/dev/V2_EXECUTION_PLAN.md && test $(wc -l < docs/dev/STATE.md) -le 50`

- [x] `A3-4` **垂直拆分 Step 3～5、Workspace 與 Bootstrap，達成 `index.html` 零內嵌 `<script>`**
  - **程式碼檔案**：新增 `dispatchLocalComfy.ts`、`dispatchCloudApi.ts`、`stagePlayer.ts`、`audioSubtitles.ts`、`workspaceManager.ts`、`client/bootstrap.ts`；移除 `studioAudioSubtitles.js` 與 `legacyGlobalBridge.ts`；更新 `windowBindings.ts`、`main.ts`、`public/index.html`、`tests/dom_integrity.test.js`。
  - **🔍 驗證指令**：
    `npm run typecheck --prefix film-chain && npm test --prefix film-chain && test $(wc -l < film-chain/public/index.html) -lt 1500 && grep -q "\- \[x\] \`A3-4\`" docs/dev/STATE.md && grep -q "\- \[x\] \`A3-4\`" docs/dev/V2_EXECUTION_PLAN.md && test $(wc -l < docs/dev/STATE.md) -le 50`

- [x] `A3-5` **架構單向依賴與 Bridge 契約測試建立（初版）**
  - **程式碼檔案**：新增 `film-chain/tests/architecture.test.ts`；更新 `film-chain/tsconfig.json`、`film-chain/package.json`。
  - **驗收缺口紀錄**：原 Gate 因先執行 `python3 -m unittest` 生成 `__pycache__/*.pyc` 後再用無 `-I` 的 `! grep -rn "/Users/"` 掃描二進位 `.pyc` 導致 **Exit code 1**，隨後僅補跑後半段 Python / Ruff / `grep -rnI`，未從頭重跑整條 Gate。所有未竟總驗收與 Code Review 收斂要求統一併入 **階段 A4（`A4-1` ～ `A4-6`）**。

---

## Full Phase A Verification Gate（Fail-Closed 單指令門禁）

所有 Phase A 批次（`A4-1` ～ `A4-6`）修改完成後，必須一次從頭到尾執行下列完整 Gate 且必須 **Exit code 0**（嚴禁拆段執行或僅重跑失敗子項；其中 Layer 1 CI 結構檢驗於 `A4-1` 完成後永久納入）：

```bash
/bin/bash -Eeuo pipefail <<'EOF'
NODE_LOG="$(mktemp)"
PY_LOG="$(mktemp)"
trap 'rm -f "$NODE_LOG" "$PY_LOG"' EXIT

npm run typecheck --prefix film-chain
npm run build --prefix film-chain
test -s film-chain/public/dist/studio.js

npm test --prefix film-chain | tee "$NODE_LOG"
/usr/bin/python3 - "$NODE_LOG" <<'PY'
import re, sys
MIN_NODE_TESTS = 92  # 隨新增測試同步調升基準，嚴禁下調
txt = open(sys.argv[1], encoding="utf-8").read()
parsed = {}
for k in ("tests", "pass", "fail", "skipped", "cancelled", "todo"):
    hits = re.findall(rf"^ℹ {k} (\d+)$", txt, re.M)
    if len(hits) != 1:
        print(f"PARSE_ERROR: Node summary field '{k}' matched {len(hits)} times (expected 1)")
        sys.exit(1)
    parsed[k] = int(hits[0])
if re.search(r"^not ok \d+", txt, re.M):
    print("FAIL: TAP 'not ok' line detected in Node test output")
    sys.exit(1)
t, p, f, s, c, td = (parsed[k] for k in ("tests", "pass", "fail", "skipped", "cancelled", "todo"))
print(f"Node: {p}/{t} pass (min>={MIN_NODE_TESTS}, fail={f}, skipped={s}, cancelled={c}, todo={td})")
if not (t >= MIN_NODE_TESTS and p == t and f == 0 and s == 0 and c == 0 and td == 0):
    sys.exit(1)
PY

python3 -m unittest discover -s tests 2>&1 | tee "$PY_LOG"
/usr/bin/python3 - "$PY_LOG" <<'PY'
import re, sys
MIN_PY_TESTS = 128  # 隨新增測試同步調升基準，嚴禁下調
txt = open(sys.argv[1], encoding="utf-8").read()
ran = re.findall(r"^Ran (\d+) tests? in [0-9.]+s$", txt, re.M)
if len(ran) != 1:
    print(f"PARSE_ERROR: Python unittest 'Ran N tests' matched {len(ran)} times (expected 1)")
    sys.exit(1)
n = int(ran[0])
if re.search(r"^FAILED\b", txt, re.M):
    print("FAIL: Python unittest reported FAILED")
    sys.exit(1)
statuses = re.findall(r"^(OK(?:\s*\(.*\))?)$", txt, re.M)
if statuses != ["OK"]:
    print(f"PARSE_ERROR_OR_SKIP: Expected exact single 'OK' line, got {statuses}")
    sys.exit(1)
print(f"Python: Ran {n} tests, status=OK (min>={MIN_PY_TESTS})")
if n < MIN_PY_TESTS:
    sys.exit(1)
PY

.venv/bin/ruff check .

/usr/bin/python3 - <<'PY'
import subprocess, sys
r = subprocess.run(
    ["grep", "-rnI", "--exclude-dir=__pycache__", "--exclude-dir=.git", "--exclude-dir=node_modules",
     "/Users/", "pipeline", "tests", "examples", "README.md", "film-chain/client"],
    capture_output=True, text=True,
)
if r.returncode == 1:
    print("Path Hygiene: PASS (0 matches)")
    sys.exit(0)
print(f"Path Hygiene FAILED (rc={r.returncode}):\n{r.stdout}{r.stderr}")
sys.exit(1)
PY

CI_JSON="$(ruby -ryaml -rjson -e 'puts JSON.generate(YAML.safe_load(File.read(".github/workflows/ci.yml"), aliases: true))')"
/usr/bin/python3 - "$CI_JSON" <<'PY'
import json, sys
wf = json.loads(sys.argv[1])
jobs = wf.get("jobs") or {}
for req in ("test", "frontend"):
    assert req in jobs, f"Missing CI job: {req}"
fe_steps = jobs["frontend"].get("steps") or []
assert any(str(s.get("uses", "")).startswith("actions/setup-node@") and (s.get("with") or {}).get("node-version") for s in fe_steps), "Missing setup-node with node-version"
fe_runs = "\n".join(str(s.get("run", "")) for s in fe_steps)
for cmd in ("npm --prefix film-chain ci", "typecheck", "build", "test"):
    assert cmd in fe_runs, f"Missing frontend CI step command: {cmd}"
py_runs = "\n".join(str(s.get("run", "")) for s in (jobs["test"].get("steps") or []))
for cmd in ("ruff check .", "unittest discover -s tests"):
    assert cmd in py_runs, f"Missing python CI step command: {cmd}"
assert '! grep -rn "/Users/"' not in py_runs, "Unsafe bare ! grep -rn remains in ci.yml"
print("CI Layer-1 Static Validation: PASS (jobs=test,frontend)")
PY

test "$(wc -l < film-chain/public/index.html)" -lt 1500
test "$(wc -l < docs/dev/STATE.md)" -le 50
git status --short
EOF
```

> **Fail-Closed 判準**：`set -Eeuo pipefail` 確保管線前端任何非零結束碼（含 `npm test | tee` 與 `unittest | tee`）即時中止；Node / Python 解析器對未知格式、多行或缺失摘要行均回傳 `PARSE_ERROR` 並拒絕通過；Path Hygiene 僅接受 `rc == 1`（`0` 與 `>= 2` 一律失敗）。
> **兩層 CI 驗收區分**：本機 Gate 中的 Ruby YAML + JSON 腳本屬於 **Layer 1（靜態定義完整性檢驗）**，僅證明 Workflow YAML 合法且定義了 `frontend` / `test` jobs 與步驟；**Layer 2（遠端 CI 實跑結果）** 須於 `A4-6` 核對推送 Commit SHA 對應的 GitHub Actions 實際執行狀態為 `success`，兩層不可混為一談。
> **Git Diff 判準**：驗收時以 `git status --short` 與 `git diff --stat HEAD` 逐項對照核可的變更清單；屬於 Phase A / A4 未提交的預期開發修改**不得**被誤判為工作目錄不乾淨，僅禁止遺留暫存檔、`.bak`、`scratch/` 產物或範圍外檔案。

---

## 階段 A4：收斂修訂與全倉驗收（`A4-1` ～ `A4-6`，待確認後循序執行）

- [x] `A4-1` **修正 Full Gate、打通本機 `:8080` 靜態服務與 `start_studio.sh` 自動建置、CI 納管前端測試**
  - **範圍**：`pipeline/h3_server.py`、`tests/test_h3_server.py`、`scripts/start_studio.sh`、`.github/workflows/ci.yml`、`docs/dev/STATE.md`、`docs/dev/V2_EXECUTION_PLAN.md`。
  - **實作要點**：
    1. `pipeline/h3_server.py` `do_GET` 新增唯讀靜態資產路由，將 `/` 對應至 `film-chain/public/index.html`，其餘非 `/api/` 路徑以 `Path.resolve()` 嚴格限制於 `film-chain/public/` 內（防範 `..` / symlink 目錄穿越）並回傳正確 MIME 型別（`.html` / `.js` / `.css` / `.png` / `.mp4`）。
    2. `scripts/start_studio.sh` 於啟動服務前自動執行 `npm run build --prefix film-chain`（若 `film-chain/node_modules` 缺失則輸出清晰提示或執行安裝），並改以 `http://127.0.0.1:8080/` 開啟 Studio UI（消除 fresh clone 缺 `dist/studio.js` 與 `file://` 斷鏈）。
    3. `.github/workflows/ci.yml` 新增獨立 `frontend` job（`actions/setup-node` + `npm --prefix film-chain ci` + `typecheck` + `build` + `test`），並將 Path Hygiene 改為 3 態 exit code 檢查（移除裸 `! grep -rn`）。
  - **🔍 驗收標準**：`tests/test_h3_server.py` 覆蓋靜態資源 200、`/dist/studio.js` MIME 與目錄穿越 `403/404` 阻擋；`scripts/start_studio.sh` 經 `bash -n` 驗證；**Layer 1 CI 靜態結構檢查通過**且完成完整 Fail-Closed Full Gate（Exit 0；**Layer 2 遠端實跑結果**於推送後在 `A4-6` 確認，不以本機檢驗替代遠端 CI）。

- [x] `A4-2` **修復狀態映射回歸、強化 Store 外部不可變封裝、全量稽核 45 處動態 HTML Sink 與清理舊 CLI 字串**
  - **範圍**：`client/types/studio.ts`、`client/utils/domSafety.ts`（新增）、`client/stores/createStore.ts`、`client/stores/storyboardStore.ts`、`client/stores/coreStore.ts`、`client/stores/computeStore.ts`、`client/stores/audioSubtitleStore.ts`、`client/features/uiShell.ts`、`sessionColab.ts`、`storyboardEditor.ts`、`phoneticsLexicon.ts`、`stagePlayer.ts`、`director.ts`、`dispatchCloudApi.ts`、`dispatchLocalComfy.ts`、`audioSubtitles.ts`、`workspaceManager.ts`、`client/bootstrap.ts`、`client/registry/windowBindings.ts`、`tests/stores.test.ts`、`tests/dom_safety.test.ts`、`film-chain/package.json`。
  - **實作要點**：
    1. 正確性與契約回歸修補：統一 `ComputeRoute = "colab" | "saas_api" | "local"` 與 `StartWorkflowMode = "web" | "agent"`；修正 `sessionColab.ts#L94` `routeGpu` 判斷 `"saas_api"`；修正 `storyboardEditor.ts#L745` 改由 `storyboardStore.getState().refImageBase64`（與 `#refPreview` `src`）判斷自訂參考圖；修正 `workspaceManager.ts#L20` 在 `syncSegmentsFromDOM()` 後才讀取快照；清理 `stagePlayer.ts#L403` 與 `storyboardEditor.ts#L639` 裸調腳本字串為 `python3 -m pipeline.h3_cli`。
    2. **Store State 型別限制與 `deepFreeze` 契約**：
       - **允許之領域資料型別**：僅限 Primitive（`string | number | boolean | null | undefined`）、Plain Object（原型為 `Object.prototype` 或 `null`）與 `Array`。
       - **明確拒絕不支援之內建可變物件**：禁止將 `Map`、`Set`、`Date`、`RegExp`、`WeakMap`、`WeakSet`、`ArrayBuffer` / `TypedArray` 放入 Domain Data State；`createStore` 於開發／測試模式對這類物件**直接拋出 `TypeError`**，絕不宣稱 `Object.freeze()` 可凍結其內部狀態。
       - **瀏覽器 Runtime Handle 隔離白名單**：`Blob`、`WebSocket`、`EventSource`、`AbortController`、`AudioContext`、`AudioBuffer`、`AudioNode`、Timer ID 與 Promise resolver 僅得存放於顯式標記的 Opaque Handle 欄位（白名單跳過凍結，不偽裝為不可變資料）。
       - **不可變 Actions**：於 `storyboardStore` 新增 `updateSegments`、`updateSegmentAt`、`updatePlanMeta`，消除全部 6 處就地變異 `currentPlan`。
    3. **全量 45 處動態 HTML Sink 脈絡分類與防護**（`45` 為盤點總數，**禁止**一律機械套用 `escapeHtml()`）：
       - 逐一產出五欄分類稽核表：**（1）輸入資料來源、（2）是否含使用者／外部可控資料、（3）DOM API、（4）脈絡安全策略（純文字改 `textContent`／`.value`、`<textarea>` 改 `.value` 設定、`href`/`src` 採 `sanitizeUrl()` 協定白名單＋`setAttribute`、內聯數值引數強制整數、HTML 文字插值才使用 `escapeHtml`）、（5）對應測試**。
  - **🔍 驗收標準**：新增單元測試驗證「外部變異 `getState().currentPlan` 拋出 `TypeError` 且內部 State 不變」以及「傳入 `Map` / `Set` / `Date` 至 `setState` 明確拒絕拋出 `TypeError`」；45 處 Sink 全數完成五欄分類與脈絡修正，並通過 `</textarea><script>`、引號逃逸與 `javascript:` URL 測試；完整 Fail-Closed Full Gate（Exit 0）。

- [x] `A4-3` **開啟 TypeScript `strict: true`、集中常數、精簡 `windowBindings.ts`、強化架構測試與 `.mts` 靜音**
  - **範圍**：`film-chain/tsconfig.json`、`film-chain/client/config/constants.ts`（新增）、`film-chain/client/utils/errors.ts`（新增）、`film-chain/client/package.json`（新增）、`film-chain/src/package.json`（新增）、`film-chain/client/registry/windowBindings.ts`、`sessionColab.ts`、`vite.config.mts`（由 `.ts` 改名）、`tests/architecture.test.mts` / `tests/stores.test.mts` / `tests/dom_safety.test.mts` / `tests/worker_session.test.mjs`、`film-chain/package.json`。
  - **實作要點**：
    1. `tsconfig.json` 開啟 `"strict": true`（移除 `strict: false`、`noImplicitAny: false`、`strictNullChecks: false`），將 `vite.config.mts` 納入檢查，消除無必要的鬆散型別與不安全 `any`（保留明確且可驗證邊界的型別定義）。
    2. 新增 `client/config/constants.ts` 集中管理 `:8080` Daemon URL、`localStorage` keys 與共用時序／畫布／語速閾值常數。
    3. 精簡 `windowBindings.ts` 僅註冊 `index.html` 與動態 HTML 實際使用的 inline handlers + 8 項外部 Bridge 契約（含唯讀 `window.currentActiveProjectId` getter），將 `_renderColabPipelineTrackerInner` 收斂為模組私有。
    4. 升級 `tests/architecture.test.mts` 擴充 import 擷取涵蓋 `export ... from`、動態 `import()`、`require()` 及 `createStore.ts` 邊界，並檢查 `public/src/core/*.js` 不依賴 UI/DOM（**嚴禁加入機械式函式行數限制斷言**）；改用 `.mts` 消除 Node `MODULE_TYPELESS_PACKAGE_JSON` 與 Vite native config 警告。
  - **🔍 驗收標準**：`tsc --noEmit`（`strict: true`）0 錯誤；`npm test` 0 `MODULE_TYPELESS_PACKAGE_JSON` 警告；`vite build` 0 configLoader 警告；Full Gate 全綠。

- [x] `A4-4` **證據驅動重構 Batch 1（編導、分鏡、Colab、UI Shell）**
  - **實作範圍與設計卡（5 Cards）**：`client/utils/errors.ts`（`formatDiagnosticError`）、`director.ts`（`dispatchPlanByProvider` / `generateStep1GridImage`）、`storyboardEditor.ts`（共用 `dispatchPlanByProvider`、`resolveSegmentCardContext` / `buildSegmentChainControlHtml`）、`sessionColab.ts`（`computeSegmentTimeRanges`、`markRenderCardsDone` / `applySessionStageProgress`）、`uiShell.ts`（`syncModeToolbarUI` / `syncSegmentCardsModeBadges`）、`panelRefiner.ts`、`tests/refactor_helpers.test.mts`。
  - **豁免保留單一職責函式（不硬拆）**：`createGoldenProjectObject`、`buildDirectorSystemPrompt`、`normalizeAgentPlan`、`callPlanViaLocalLLM`、`onChainParadigmChange`、`renderChainTimelineBar`、`syncSegmentsFromDOM`、`exportChainedManifest`、`splitSegmentCardInTwo`、`updateDurationBadge`、`startSessionListener`、`updateColabPromptText`、`updateStep3UI`、`loadSampleEduDoc`、`extractEduOutlines`、`generateEduStoryboardFromOutlines`、`updatePacingBadgeForCard`、`executeSinglePanelAiRegen`。
  - **重構目標與克制界線**：以實質降低維護與 Bug 風險為限，不做無止境的指標導向重構。`50 行 / 3 層縮排 / 3 參數` 僅作 **Code Review 警示門檻**，禁止機械式拆小函式；任何拆解必先完成 **4 項重構設計卡（原始設計問題／實際複雜度或耦合問題／預計改善的職責邊界／拆解後驗收方式）**；具單一清晰職責且無明顯維護風險者（例如 `createGoldenProjectObject`）明確保留並記錄豁免理由。
  - **候選評估標的**：`director.ts`（`executeStep1`、`callPlanViaGemini`、`callPlanViaOpenAI`、`buildAgentPlanTaskPack`、統一 `H3CloudDiagnostics` 錯誤轉譯 helper）、`storyboardEditor.ts`（`appendSegmentCardDOM`、`renderChainTimelineBar`、`syncSegmentsFromDOM`、`exportChainedManifest`、`replanCurrentSegmentsViaAI`）、`sessionColab.ts`（`_renderColabPipelineTrackerInner`、`handleSessionUpdate`、`buildColabCompatibleManifest`）、`uiShell.ts`（`selectProjectMode`、`updateStep3UI`）、`eduStudio.ts`、`panelRefiner.ts`。
  - **🔍 驗收標準**：每個改動函式均具備 4 項設計卡紀錄，未改動超長函式皆具明確豁免理由；目標模組行為 100% 等價；完整 Fail-Closed Full Gate（Exit 0）。

- [x] `A4-5` **證據驅動重構 Batch 2（算力調度、播放器、音訊、工作區與資源洩漏修補）**
  - **重構目標與克制界線**：同 `A4-4`（4 項設計卡優先、單一職責豁免不硬拆、`buildComfyApiPrompt` / `executeLocalComfyStep` / `executeCloudSaveOption` / `mergeAndDownloadCloudClips` / `renderSegmentsPlaylist` / `applyProjectStateToUI` / `initWorkspaceOnLoad` / `replaceShotSpeechOnly` / `registerStudioBootstrap` 等明確豁免）。
  - **已落地修復與設計卡（5 Cards）**：`stagingCanvas.ts` 全域 `window` 拖曳監聽器僅於拖曳期間掛載並於結束/清理時解除；`uiShell.ts` `playCompletionChime` 與 `audioSubtitles.ts`（`handleCustomBgmUpload`、`renderMixedAudioTrack`、`executeMasterAudioVideoMux`）一次性 `AudioContext` 於結束/`finally` 釋放 `.close()`；`storyboardEditor.ts` / `workspaceManager.ts` / `uiShell.ts` 統一使用 `copyTextToClipboard`；`audioSubtitles.ts` 拆出 `renderMixedAudioTrack` 與 `drawBurnInSubtitleOnCanvas`；`stagePlayer.ts` `triggerRerollExecution` 拆為 `dispatchColabReroll` 與 `dispatchCloudApiReroll` 並連同 `dispatchCloudApi.ts` 接上 `formatDiagnosticError`；新增 `tests/resource_lifecycle.test.mts`。
  - **🔍 驗收標準**：每個改動均附 4 項設計卡，豁免項目均有紀錄；`stagingCanvas.ts` 與 `AudioContext` 生命週期具單元測試覆蓋；完整 Fail-Closed Full Gate（Exit 0）。

- [x] `A4-6` **完整端到端 Gate 驗收、Git Diff 範圍確認與 Layer 2 CI ＋ 雙軸複驗**
  - **實作要點**：
    1. 一次性從頭執行完整 **Fail-Closed Full Gate**（Exit 0），紀錄 Node 實際數／失敗／跳過數、Python 實際數／失敗／跳過數、Vite build 產物與耗時、Ruff、3 態 Path Hygiene 與 Layer 1 CI 結構檢查結果。
    2. 對照 `git status --short` 與 `git diff --stat HEAD`，確認變更均為預期 Phase A / A4 產物且無遺留垃圾檔（不把合理未提交開發變更誤判為失敗）。
    3. 確認 **Layer 2 遠端 CI**：於推送後核對該 Commit SHA 對應之 GitHub Actions 實際執行結果為 `success`（若環境尚未推送，必須明確標記「待推送遠端驗證」，不得宣告遠端 CI 已通過）。
    4. 重新執行 `/code-review` 雙軸複驗，達成 **Spec = `PASS`** 與 **Standards = `PASS`**（既有功能正確、架構邊界清楚、部署可重現、品質可自動驗收、具備 Phase B 穩定契約），方將 `STATE.md` 標記 Phase A 結案。
  - **🔍 驗收紀錄**：Fail-Closed Full Gate Exit 0（Node `89/89 pass`, `0 fail`, `0 skip`, 0 `MODULE_TYPELESS_PACKAGE_JSON` 警告；Python `127/127 OK`；TS `strict: true` 0 錯誤；`vite build` 0 `configLoader` 警告；Ruff PASS；Path Hygiene PASS `rc=1`；CI Layer-1 PASS）；Dual-Axis Review：**Spec = `PASS`**、**Standards = `PASS`**；**Layer 2 遠端 CI：待推送遠端驗證**（本地變更保留於工作目錄供審視）。

---

## UI/UX 精修微批次（U0～U3，位於 Phase A 之後、B0-SPEC 之前）

- [x] `U0-DOCS` **獨立更新工程文件 [`AGENTS.md`](../../AGENTS.md)**：反映 `film-chain/client/` TypeScript + Vite 架構、明確禁止手改 `public/dist/`、補充 `./scripts/start_studio.sh` 與前後端驗證指令（不混入 UI 改動）。
- [x] `U1-CONSISTENCY` **Batch 1（P0）：產品一致性、執行規則 SSOT 與 GPU 授權治理對齊**：
  - 建立 `film-chain/config/execution_rules.json` 與 `film-chain/client/config/executionRules.ts`（品牌、5 階段流程、兩階段授權鐵律與三路線規則 SSOT）。
  - 全面移除 UI（路線 1 卡片、步驟三算力指南）與 `eduStudio.ts` 範例文本內無授權 GPU 自動降級／`Auto-Fallback`／`--no-fallback`／`--no-high-mem` 承諾與過時參數。
  - 統一品牌為 `H3 Storyboard Studio`、流程為 5 階段、修正裸露 Markdown 反引號與 `selectRoute('saas_api')`，並更新 `public/h3ServeBridge.js` 引導 Prompt 與精靈第 4 步（`./scripts/start_studio.sh` 與 `python3 -m pipeline.h3_cli usage`）。
  - 新增 `architecture.test.mts` 與 `tests/test_execution_rules_sync.py` 跨端鎖定規則一致性。
- [ ] `U2-IA-WORKFLOW` **Batch 2（高優先）：首屏漸進式揭露與 Web-First / Agent-First 雙工作介面**：收斂頂部安全聲明與模式說明、三路線改為「保留摘要、預設展開當前所選」、將步驟一帶入首屏、區分 Web-First（完整工作台）與 Agent-First（精簡工作台，共用同一套 Store）及 4 類階段式 Agent Prompt 入口。
- [ ] `U3-FEEDBACK` **Batch 3（高優先）：範例載入動態摘要、資料驅動 5 階段進度列與渲染前授權成本摘要**：同步高亮選中範例、動態計算專案摘要並防呆檢查成品是否存在、新增純函式 `deriveWorkflowProgress()` 驅動進度條、統一三路線渲染前成本與資源授權摘要。

---

## 階段 B：引擎擴充前導契約（`B0-SPEC`，Phase A 與 U0～U3 結案後方可啟動）

- [ ] `B0-SPEC` **契約先行（立案 `ADR-0003`）：定義 `TimelineSpec`、分離 `VoiceProvider` 與 `ResourceScheduler`、鎖定 `HyperFrames` 轉接契約**
  - **前置條件**：僅於 `A4-6` 達雙軸 `PASS` 且 Full Gate 全綠後方可開啟；此批次僅產出設計契約與型別骨架，不寫入推理或渲染實作。
  - **三大核心邊界設計**：
    1. **`TimelineSpec` 統一時間軸契約**（Single Source of Truth）：
       - **Timebase（時間基準）**：以整數刻度／微秒或統一格率座標表示絕對時間，Storyboard 段落、對白音軌、字幕 Cue、BGM 閃避（Ducking）與 Compositor 軌道共享同一座標基準。
       - **Frame Rate（影格率）**：定義標準基準格率 `24 fps`（與 H3 `frames / 24` 與變數教育分段格數對齊），所有視訊片段起訖皆具明確幀邊界。
       - **Audio Sample Rate（音訊取樣率）**：定義基準系統取樣率為 `32000 Hz`（對齊 H3 原生音軌），並明確宣告外部 TTS（如 Qwen3-TTS `24000 Hz`）或母帶輸出（`48000 Hz`）的強制重取樣契約（不得靜默混接不同取樣率）。
       - **Sync Rules（音畫同步規則）**：顯式區分 `audio-first`（對白決定鏡段時長、視訊補幀／擴展或依策略裁切）與 `video-first`（鏡段時長鎖定、對白起音偏移與語速超標拒絕／自動鴨避），並規範字幕時間窗與 BGM Ducking 前後緩衝邊界。
    2. **`VoiceProvider` 與 `ResourceScheduler` 嚴格職責分離**：
       - **`VoiceProvider`（純語音合成／克隆契約）**：僅定義 `capabilities()`、`createProfile(input)`、`synthesize(request)`、`getJobStatus(jobId)` 與授權／同意元資料（語言、參考音檔、Transcript、模型版本；14 秒僅為 UI 預設錄音時長，非品質最佳理論值）。嚴禁將 GPU／RAM 搶佔與排程邏輯寫死於 Provider 介面內。
       - **`ResourceScheduler`（獨立資源生命週期與互斥調度層）**：管理 Apple Silicon Unified Memory 與 Metal Compute 預算（狀態：`unloaded -> loading -> ready -> busy -> unloading`），統一協調 H3 視訊引擎、`Qwen3-TTS`（0.6B/1.7B 及 KV Cache 實際記憶體開銷）與 `HyperFrames` 的載入優先序、排隊佇列、任務後自動卸載與中斷釋放。
    3. **`HyperFrames` Compositor 轉接契約**：單向消費 `TimelineSpec` 與既有 Frame Contract 輸出渲染任務，嚴禁反向修改 Storyboard / Store / Voice 業務規則。
