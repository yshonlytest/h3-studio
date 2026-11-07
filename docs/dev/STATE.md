# STATE.md — 專案狀態索引與 3.8 Flash 單向微批次清單

> 守則見 [AGENTS.md](../../AGENTS.md)、規範見 [docs/STANDARDS.md](../STANDARDS.md)。**3.8 Flash 嚴禁自行發散架構，僅依序執行下方 M1~M7，每步跑完驗證指令才打勾。全部完成後交由 Argon 最終驗收。**

## 1. 四大核心問題與架構收斂定案（Argon 裁決，3.8 勿改）
- **資產與路徑四層隔離（解決問題 3 & 4）**：
  1. `examples/`（Git 追蹤，開源範本）：僅放 JSON Manifest 與輕量錨定圖（`<2MB`）。
  2. `film-chain/public/assets/demo/`（Git 追蹤，Cloudflare 線上靜態展示）：只放已驗證完稿的展示影片與九宮格（賽博偵探 `detective_*`；仙俠完稿後才由腳本發佈至此）。
  3. `outputs/storyboard_runs/`（`.gitignore`，本機算圖正式產出）：所有 CLI / Daemon 產出的 `.mp4`、`.h3.log`、`.state.json` 唯一落點。**廢除 `MiniMax-H3-h3c-ComfyUI/ComfyUI/output` 舊 fallback**。
  4. `scratch/`（`.gitignore`，純暫存）：僅供執行期中繼檔（`.h3ctx`、臨時 manifest），禁止存放成品影片。
- **接力範式與重錨定修正（解決問題 1 & 2）**：
  - 區分兩種範式：`latent_chain`（PR #76 `--motion-context` 一鏡到底，僅第 1 段用首幀/九宮格 Panel 1，第 2~5 段禁設 `anchor_reset: true` 覆蓋 `first_frame`，改以 Prompt 外貌錨定詞防漂移）與 `grid_keyframes`（3×3 九宮格 Panel 1~9 首尾幀轉場）。
- **工具鏈打通（解決問題 1 & 2）**：
  - `h3_server.py` 補齊 `POST /api/expand`（調用 `h3_context_ir.expand_with_local_llm` + `h3_staging_board`）與 `POST /api/character-sheet`（調用 `h3_character_sheet.py`）。
  - `film-chain/public/index.html` 匯出 `window.exportChainedManifest()`（供 `h3ServeBridge.js:165` 讀取當前分鏡與範式，不再掉回寫死假資料），並在 Step 1/2 加入「接力範式切換」與「本機 LLM 擴寫」選項。

## 2. 3.8 Flash 單向執行微批次清單（不得交錯、禁止啟動真機 GPU 算圖）
- [x] **M1（清理工作區垃圾與收斂 `config.py` 路徑）**：
  - 刪除 `scratch/` 下所有殘留 `.mp4`、`.png`、`output_25s/`、`*.json`（保留 `gdrive_folder_cache.json`）及 `outputs/noop_test.state.json`。
  - 修改 `pipeline/config.py:94-109` `get_output_dir()`：移除 `cand_legacy` (`MiniMax-H3-h3c-ComfyUI/ComfyUI/output`) fallback，固定回傳 `REPO_ROOT / "outputs"`（支援 `H3_OUTPUT_DIR` 覆寫）。
  - 驗證：`python3 -m unittest discover -s tests && .venv/bin/ruff check pipeline/config.py`
- [x] **M2（修正雙範本 Part 4 跳針與補齊九宮格/外貌鎖定欄位）**：
  - 修改 `examples/storyboards/xianxia_aerial_duel_25s.json` 與 `cyberpunk_detective_25s.json`：移除第 4 段 `"anchor_reset": true` 與 `"first_frame"`，改為 `"chain_mode": "motion_context"`，並在 Part 4 Prompt 開頭補上連貫前綴與明確服裝五官描述。
  - 驗證：`python3 -m unittest tests/test_prompt_linter_and_manifests.py`
- [x] **M3（CLI 接入 `ContextIR`、`expand_with_local_llm` 與 `StagingBoard`）**：
  - 修改 `pipeline/h3_storyboard_pipeline.py`：當 segment 含 `"context_ir"` dict（及可選 `"camera_track"`）時，自動調用 `compile_camera_direction` 與 `compile_context_ir`（若帶 `--expand-llm` 則調用 `expand_with_local_llm`）生成 `seg["prompt"]`。
  - 新增單元測試驗證 manifest 內 `context_ir` 自動編譯為合規 Prompt。
  - 驗證：`python3 -m unittest discover -s tests && .venv/bin/ruff check pipeline/`
- [x] **M4（`h3_server.py` 新增 `/api/expand` 與 `/api/templates` 端點）**：
  - 修改 `pipeline/h3_server.py:170-220`：新增 `GET /api/templates`（回傳 `examples/storyboards/*.json` 清單與內容）與 `POST /api/expand`（接收 5D Context-IR + 運鏡座標，回傳編譯/擴寫後 Prompt 與 Linter 分數）。
  - 在 `tests/test_h3_server.py` 新增對應測試。
  - 驗證：`python3 -m unittest tests/test_h3_server.py && .venv/bin/ruff check pipeline/h3_server.py tests/test_h3_server.py`
- [x] **M5（修復 `h3ServeBridge.js` 假資料斷路，實作 `window.exportChainedManifest`）**：
  - 於 `film-chain/public/index.html`（Step 2 `syncSegmentsFromDOM` 附近，約 `L3352-3375`）實作並掛載 `window.exportChainedManifest()`，將當前 `currentPlan`、畫布設定、各段 `chain_mode` 與首幀轉為標準 Manifest 結構；刪除 `h3ServeBridge.js:173-192` 的 1 段式寫死 fallback，改為無分鏡時提示先於步驟一/二載入分鏡。
  - 驗證：`cd film-chain && npm test`
- [x] **M6（Web UI 補齊「潛空間 vs 九宮格範式開關」、「本機 Context-IR 擴寫」與「官方範本載入」）**：
  - 於 `film-chain/public/index.html` Step 1 (`L1040-1065`)：`promptProviderSelect` 新增 `<option value="local-llm">🖥️ 本機 Context-IR / Local LLM (免 API Key)</option>`；新增「接力範式 (`chainParadigmSelect`)」下拉選單（`latent_chain` 一鏡到底 vs `grid_keyframes` 九宮格轉場），選 `latent_chain` 時批次將 Part 2~N 設為 `motion_context` 並摺疊九宮格切片列。
  - 新增「載入官方 25s 範本（仙俠空戰 / 賽博偵探）」按鈕。
  - 驗證：`npm test --prefix film-chain`（52/52 passed）
- [x] **M7（全套自動化測試與 Lint 總閘門，等待 Argon 驗收）**：
  - 執行：`python3 -m unittest discover -s tests && .venv/bin/ruff check . && npm test --prefix film-chain`
  - 狀態：39 Python 單元測試全數通過、Ruff 零警報、53 前端單元測試全數通過。未執行真機 GPU 算圖。
- [x] **U1–U4（獨立程式碼審視報告 P0/P1/P2 全數落地）**：
  - **P0 #1（雙軌模式防覆蓋）**：`onChainParadigmChange(true)` 偵測步驟二自訂段落並彈窗詢問是否覆寫，步驟二頂部新增「批次設為潛空間 / 批次設為九宮格」按鈕。
  - **P0 #5 & #6（步驟一與步驟三等待回饋與預期管理）**：步驟一加入三階段動態進度列與按鈕狀態、移除強制 `scrollIntoView` 滾動突襲；步驟三本地面板加入「引擎自動偵測狀態 + 預估總時長」與 `#localPipelineGrid` 分段進度卡，並修復 ComfyUI `/history` 多段影片完整收集。
  - **P1 #2（鏈式時間軸視覺化與隱藏無意義 Panel 選單）**：步驟二頂部新增 `#chainTimelineBar` 視覺化接力鏈，潛空間模式下自動隱藏 `Panel 1~9` 選單並改顯示「🔗 承接 Part N 潛空間尾幀」標籤。
  - **P1 #3 & #4（5D 雙向非破壞性同步 + 2D 運鏡板升級）**：修改任一 5D 欄位時僅局部替換對應 `[Scene]` / `[Camera]` / `Timeline:` / `[Look]` / `Audio:` 段落，並提供「↩️ 復原上一版 Prompt」按鈕；2D 運鏡板畫布放大至 `280×160`、熱點半徑 `24px` 含 Hover 光圈。
  - **P2（術語收合、觸控目標放大、手機 Tooltip 彈窗與 Toast 統一）**：首屏 Colab/本機卡技術細節收合進 `<details>`，`.info-tip` 點擊統一開啟說明視窗，消除阻斷式 `alert()`。
- [x] **C1（本地環境中樞整合：狀態核心 ＋ 移除 UI hack）**：
  - `film-chain/public/h3ServeBridge.js`：新增 `window.H3LocalEnv` 狀態核心（單一輪詢器，含 `daemon` / `engine` / `hardware.availableGiB` / `job` 狀態、`getState()` / `checkNow()` / `startRender()` / `subscribe()` 公開 API），SSE 事件與 `/api/status` 輪詢皆改寫入狀態核心並通知訂閱者。
  - `film-chain/public/index.html`：移除 `executeLocalComfyStep()` 內模擬點擊 `#h3-hud-render-btn` 的 hack，改呼叫 `H3LocalEnv.startRender()`；`checkComfyConnection()` 的 8080 檢查改由狀態核心提供，消除重複輪詢。
  - 驗證：`node --check` 兩檔語法通過；`npm test --prefix film-chain` 53/53 passed。
- [x] **C2＋C3（HUD 併版升級為「本地環境中樞」與環境就緒精靈）**：
  - `film-chain/public/h3ServeBridge.js`：HUD 更名「本地環境中樞」，`checkDaemonStatus()` 依狀態切換兩種視圖：**離線** → 環境就緒精靈（四步 checklist：clone → `./setup.sh` Doctor → HF 下載權重 → 啟動 `h3_server`，各步附一鍵複製指令與「重新檢測」按鈕）；**在線** → 引擎／RAM 徽章＋渲染／張力檢查按鈕＋進度列。
  - HUD「開始本機渲染」改呼叫 `window.h3StudioStartLocalRender()`（index.html 暴露的統一入口，內含 Metal → ComfyUI 自動備援），無該入口時才 fallback 至 `H3LocalEnv.startRender()`。
- [x] **C4（資訊歸位：刪除步驟一對齊卡、步驟三改為純訂閱者）**：
  - 刪除 `#step1AgentPromptBox` 與 `copyAgentPrompt()`（環境引導職責移交中樞精靈），`selectRoute` 引用同步清理。
  - 步驟三本地面板的 `#localDetectedEngineBadge` 改為訂閱 `H3LocalEnv` 狀態即時更新（含可用 RAM），不再自行輪詢；面板文案指引使用者至中樞。
  - 驗證：`node --check` 通過；前端測試 53/53 passed。
- [x] **C5（HUD 收納與注意力設計：預設縮小＋切路線發光提醒）**：
  - `film-chain/public/h3ServeBridge.js`：HUD 預設縮小（標題列可點擊展開），注入 `h3HudGlow` 環繞發光 CSS；新增 `H3LocalEnv.pingAttention()`——離線判定或使用者切到路線 3 時吸附注意力，點開即自動解除。
  - `film-chain/public/index.html`：`selectRoute('local')` 時呼叫 `window.H3LocalEnv.pingAttention()`。
- [x] **C6（流程導正：Agent 必須帶使用者開網頁產出自己的影片，禁止偷跑範例）**：
  - 中樞精靈新增「🤖 複製引導 Prompt 交給 AI Agent」按鈕（`AGENT_ONBOARDING_PROMPT`）：四步架設指令＋環境就緒後引導開啟 `https://film-chain.onlytest.dev/`、選路線 3、修改使用者自己的故事提示詞走完步驟一~四；明文禁止未經同意執行 `examples/storyboards/` 示範（賽博偵探／仙俠），驗收標準為「自訂故事本機渲染成功」。
  - 步驟三指引卡補警示：Agent 代架環境時勿讓其直接跑範例 storyboard 浪費算力與點數。
  - 驗證：`node --check` 兩檔語法通過；前端測試 53/53 passed。
- [x] **C7（Colab 路線導正：遠端沙盒 403 教訓落地為 guardrails）**：
  - `film-chain/skills/minimax-h3-colab/SKILL.md` 新增「Cost & consent guardrails」：禁止未經同意跑 `examples/storyboards/*.json` 示範（燒 Compute Units）、manifest 必須來自使用者自有分鏡（網頁匯出的 `colab_manifest_*.json`）、開跑前回報預估成本、宿主環境代理禁 WebSocket 升級（握手 403 "WebSocket upgrades are not allowed"）時勿繞過——改為完成準備後把最終 `runner.py chain` 指令連成本交回使用者在無限制本機終端執行、結束前 `colab stop` 釋放閒置 session。
  - `film-chain/public/index.html`：靜態版與動態版 Colab Agent Prompt（`updateColabPromptText`）補分鏡來源鐵律（僅限使用者自有 manifest）＋403 沙盒降級指引＋開跑前點數同意。
  - 背景：遠端虛擬機實測 Colab CLI REST（new/sessions/stop）正常、OAuth 與 CU 餘額 395.63 正常，但 `agy-plugin-proxy` 封鎖 `wss://*.colab.dev` 的 WebSocket 升級，`colab exec` 於沙盒內不可用，屬環境限制非工具錯誤。
  - 驗證：`node --check` 通過；前端測試 53/53 passed。
