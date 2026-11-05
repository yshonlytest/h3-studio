# STATE.md - Single Source of Truth (3.8 Flash 專用微批次接力藍圖)

> **⚡ 給 3.8 Flash 模型的接力守則（必讀）**：
> 1. **禁止全檔讀取**：本專案 `film-chain/public/index.html` 長達 5189 行。**嚴禁整檔讀取**，請嚴格依照下方每個微步驟標註的 `StartLine` ~ `EndLine` 讀取切片（每次 $\le 100$ 行）。
> 2. **微批次執行（Vertical Micro-Batching）**：每次只做 **1 個 Micro-Step**（修改 1 個檔案或 1~2 個函式）$\to$ 立即執行該步驟附帶的 **驗證指令（Verification Command）** $\to$ 將本檔對應的 `- [ ]` 改為 `- [x]` $\to$ 再進入下一個 Micro-Step。
> 3. **沙盒與 Python 規範（極重要避坑）**：
>    - 語法檢查與純邏輯單元測試一律在標準沙盒執行：`/usr/bin/python3`（注意：macOS 系統 Python 為 3.9，所有新 Python 檔第 1 行必須寫 `from __future__ import annotations`）。
>    - `film-chain/public/src/core/*.js` 子目錄在標準終端沙盒下會回報 `Operation not permitted`，因此對 `film-chain/` 下所有檔案請**一律使用原生 `read_file` 與 `edit_file` 工具讀寫**（`read_file` / `edit_file` 不受沙盒限制）。
>    - 只有真正呼叫 `./h3` 進行 Metal GPU 算圖時，因 macOS Metal Shader 編譯需寫入 `/var/folders/.../com.apple.metalfe`，才設定 `BypassSandbox: true`。
> 4. **Martin Fowler 量化紅線**：單一函式 $\le 50$ 行、縮排 $\le 3$ 層、參數 $> 3$ 個時必須封裝為 `@dataclass(frozen=True)`、禁止空的 `except: pass`。

---

## [PINNED_CONTEXT]
- **本機硬體實測規格**：Apple M2 Max (`applegpu_g14s`)，64.0 GiB 統一記憶體，macOS 27.0.1。
- **本地模型權重盤點（`/Users/ysh/Documents/H3C/MiniMax-H3-h3c-ComfyUI/MiniMax-H3`）**：
  - ✅ 已安裝：`Qwen3-VL encoder` (62.13 GiB)、`FL2VA DiT` (61.73 GiB)、`video VAE` (9.70 GiB)、`audio VAE` (0.56 GiB)。
  - ⚠️ 未安裝：`Ref2VA DiT` (0 files) 與 `Turbo LoRA` 摺疊權重（因此本機實測一律走 `FL2VA` + `--first-frame` 或 PR #76 `--motion-context`）。
- **Code Review 雙軸全數修復（Pass Checklist）**：
  - ✅ `h3.c:649` & `h3.c:660` 對齊：`h3_storyboard_pipeline.py` 遇到 `--checkpoint-after-step` / `--resume` 時自動約束 `reuse=1` 與 `core_reuse=1`，並自動補全 `.ckpt` 輸出路徑。
  - ✅ 消除 Primitive Obsession：引入 `@dataclass(frozen=True) StoryboardJobRequest` 封裝執行參數。
  - ✅ 例外處理修補：淘汰空的 `except ProcessLookupError: pass`，全面改用 `LOGGER.debug` 記錄結構化 Context。
  - ✅ 標籤正則負向環視升級：將 `(?![^>]*>)` 升級為 `(?![^<\n>]*>)`，徹底解決多標籤時的跨標籤漏閉合問題。
  - ✅ 外部 Subprocess 超時保護：所有次要 `ffmpeg` 子行程皆補上 `timeout=30.0` ~ `timeout=120.0` 防鎖定保護。
  - ✅ 前端 Payload 補齊：`comfyPayload.js` 補充節點 `1` 的 `chain_mode` 宣告。
  - ✅ 工作區衛生：自動清除 `ComfyUI/temp/` 殘留之 `.h3ctx` 測試檔。
- **核心 C/Metal 引擎狀態（`/Users/ysh/Documents/H3C/MiniMax-H3-h3c-ComfyUI/h3.c`）**：
  - 分支：`main`（Commit `269f13e`），`./h3` 與 `libh3.a` 已編譯完成並通過 `2002/2002` C 單元測試。
  - 已整合 PR：
    - **PR #2**：`--checkpoint <path>` / `--resume <path>` / `--checkpoint-after-step <K>`
    - **PR #14**：`tools/fold_turbo_lora.py`
    - **PR #35 & #62**：Video VAE 進度回報與 Pipe `fflush(stdout)`
    - **PR #73**：`H3_VAE_PRECISION=bf16|int8`、`H3_VAE_CACHE`、`H3_VAE_PREFETCH=1`（已預設啟用）
    - **PR #76**：`--save-context <file.h3ctx>` / `--motion-context <file.h3ctx|mp4>`（鎖定前鏡末尾 22 幀 Latent + 0.917s 音訊，支援 `FL2VA` 且可與 `--last-frame`、`--ref-image` 共用）

---

## 已完成階段（Completed Phases — 勿重複施作）
- [x] **Pre-P0（上游 6 大 PR 整合編譯）**：完成於 `MiniMax-H3-h3c-ComfyUI/h3.c` (`269f13e`)。
- [x] **P0 核心模組建立**：
  - [`h3_presets.py`](file:///Users/ysh/Documents/H3C/MiniMax-H3-h3c-ComfyUI/h3_presets.py)（定義 `DRAFT`, `DRAFT_AGGRESSIVE`, `DRAFT_FALLBACK`, `BALANCED` 與 `internal_canvas`）
  - [`h3_runner.py`](file:///Users/ysh/Documents/H3C/MiniMax-H3-h3c-ComfyUI/h3_runner.py)（實作 `run_job`, `_drain_fd_chunks`, `terminate_process_group`, `cleanup_artifacts`, `H3InteractiveSession`）
  - [`h3_prompt_linter.py`](file:///Users/ysh/Documents/H3C/MiniMax-H3-h3c-ComfyUI/h3_prompt_linter.py)（實作 `LintInput`, `LintReport`, `lint_prompt`, `normalize_prompt_tags`）
- [x] **P0 全鏈路串接與 M2 Max 真機實測（Phase P0-Final）**：
  - 已串接 [`h3_storyboard_pipeline.py`](file:///Users/ysh/Documents/H3C/MiniMax-H3-h3c-ComfyUI/h3_storyboard_pipeline.py)、[`comfy_h3_bridge/__init__.py`](file:///Users/ysh/Documents/H3C/MiniMax-H3-h3c-ComfyUI/ComfyUI/custom_nodes/comfy_h3_bridge/__init__.py)、[`comfyPayload.js`](file:///Users/ysh/Documents/H3C/film-chain/public/src/core/comfyPayload.js) 與 [`film-chain/public/index.html`](file:///Users/ysh/Documents/H3C/film-chain/public/index.html)。
  - 真機實測通過：Linter 攔截測試通過、`SIGTERM` 中斷於 `0.19s` 清空進程群組與暫存 MP4、`--preset draft_aggressive` 於 `36.2s` 跑完 207 筆進度事件並產出裁切後 MP4。

---

## 待執行微批次清單（Micro-Batch Checklist for 3.8 Flash）

### Phase P1：Context-IR 五維度結構化提示詞 + 5 幀角色設定圖（共 4 個微步驟）

- [x] **Micro-Step P1.1：建立 Python 後端 `h3_context_ir.py`（5 維度結構化組裝與本地 LLM 擴寫）**
  - **目標檔案**：新增 `/Users/ysh/Documents/H3C/MiniMax-H3-h3c-ComfyUI/h3_context_ir.py`
  - **實作規格**：
    1. 第一行寫 `from __future__ import annotations`。
    2. 定義 `@dataclass(frozen=True) class ContextIR`：包含 5 個欄位 `scene: str`（場景）、`action: str`（動作与時序）、`camera: str`（運鏡與景別）、`look: str`（光影與材質）、`audio: str`（環境音與 `<d>[Chinese] 台詞</d>`）、以及選填 `continuity_from_prev: bool = False`。
    3. 實作純函式 `compile_context_ir(ir: ContextIR) -> str`（$\le 35$ 行）：
       - 將五維度組裝為 H3 標準英文段落（若 `ir.continuity_from_prev` 為 True，開頭加上 `"Create a 5-second live-action cinematic film continuing seamlessly from the exact last frame, pose, camera angle, and lighting of the previous segment."`）。
       - 內部呼叫 `h3_prompt_linter.normalize_prompt_tags()` 自動修復未閉合 `<Picture N>` 標籤後回傳。
    4. 實作 `expand_with_local_llm(ir: ContextIR, endpoint_url: str = "http://127.0.0.1:8080/v1/chat/completions", timeout_sec: float = 15.0) -> str`（$\le 45$ 行）：
       - 使用標準庫 `urllib.request` 發送 OpenAI 相容格式 POST 請求給本地 `llama-server`（或 Ollama），請模型將五維度中文/短句擴寫為英文 H3 Prompt；若連線失敗（` urllib.error.URLError` 或 `TimeoutError`），記錄 `logging.warning` 並優雅降級回傳 `compile_context_ir(ir)`。
  - **立即驗證指令**：
    ```bash
    /usr/bin/python3 -c 'import sys; sys.path.insert(0, "/Users/ysh/Documents/H3C/MiniMax-H3-h3c-ComfyUI"); from h3_context_ir import ContextIR, compile_context_ir, expand_with_local_llm; ir = ContextIR(scene="Okinawa plaza at night", action="0-5s: <Picture 1 Shisa waves paw", camera="Medium tracking shot", look="Warm lantern glow", audio="Night breeze", continuity_from_prev=True); out = expand_with_local_llm(ir, "http://127.0.0.1:9/invalid"); assert "<Picture 1>" in out and "continuing seamlessly" in out; print("P1.1 OK:", out)'
    ```

- [x] **Micro-Step P1.2：在前端 `promptBuilder.js` 新增 `compileContextIR` 輔助函式**
  - **目標檔案**：`/Users/ysh/Documents/H3C/film-chain/public/src/core/promptBuilder.js`
  - **讀取切片**：先用 `read_file` 讀取 `StartLine: 135, EndLine: 170`。
  - **實作規格**：
    1. 在 `promptBuilder.js` 新增 `compileContextIR(fields, segmentIndex)`（`fields` 為 `{ scene, action, camera, look, audio }`）：
       - 組合格式：`[Scene] ${fields.scene}. [Camera] ${fields.camera}. Timeline: ${fields.action}. [Look] ${fields.look}. Audio: ${fields.audio}.`（自動略過空白欄位）。
       - 若 `segmentIndex > 0`，套用既有 `ensureContinuityPrefix(segmentIndex, text)`。
    2. 將 `compileContextIR` 加入模組結尾 `return { ..., compileContextIR };` 匯出物件中。
  - **立即驗證方式**：使用 `read_file`（`StartLine: 145, EndLine: 195`）確認 `compileContextIR` 已加入 `promptBuilder.js` 並匯出（勿在標準沙盒 `run_command` 讀取 `src/core/*.js`）。

- [x] **Micro-Step P1.3：在前端 `film-chain/public/index.html` 分鏡卡加入可折疊「Context-IR 五維度快速填表」**
  - **目標檔案**：`/Users/ysh/Documents/H3C/film-chain/public/index.html`
  - **讀取切片**：先用 `read_file` 讀取 `StartLine: 2920, EndLine: 2990`（嚴禁讀整檔）。
  - **實作規格**：
    1. 在 `appendSegmentCardDOM(seg, idx)` (約 L2921-2945) 的 `<textarea class="seg-prompt-input">` 上方，加入一個輕量 `<details style="margin-bottom:6px; font-size:0.78rem;">` 區塊（「🧭 Context-IR 五維度結構化填表（選填，點擊一鍵合成至下方 Prompt）」），內含 5 個小型 `<input>`（`.ir-scene`, `.ir-action`, `.ir-camera`, `.ir-look`, `.ir-audio`）與一個按鈕 `onclick="applyContextIRToCard(this, ${idx})"`。
    2. 在 `appendSegmentCardDOM` 下方新增函式 `applyContextIRToCard(btnEl, idx)`（$\le 25$ 行）：讀取該卡片內 5 個 `.ir-*` 輸入值，呼叫 `H3PromptBuilder.compileContextIR(fields, idx)` 並經過 `lintH3PromptText()` 後寫入該卡片的 `.seg-prompt-input`，接著呼叫 `syncSegmentsFromDOM()`。
  - **立即驗證指令**：
    ```bash
    grep -n "applyContextIRToCard" /Users/ysh/Documents/H3C/film-chain/public/index.html
    ```

- [x] **Micro-Step P1.4：建立 `h3_character_sheet.py`（5 幀極速角色設定圖生成與第 1 幀高清抽取）**
  - **目標檔案**：新增 `/Users/ysh/Documents/H3C/MiniMax-H3-h3c-ComfyUI/h3_character_sheet.py`
  - **實作規格**：
    1. 依據案例 03（`H3-Character-Sheet-Designer`）最佳實踐：不開白模引導、預設鎖定 5~7 核心視角（`front view, side view, back view, 3/4 face close-up, full-body standing`）、固定 `--frames 5` 算圖並用 `ffmpeg -y -i <mp4> -vf "select=eq(n\,0)" -frames:v 1 <out_png>` 抽取第 1 幀作為高清角色設定圖。
    2. 定義 `@dataclass(frozen=True) class CharacterSheetSpec`：`subject_desc: str`, `output_png: Path`, `first_frame_anchor: Path | None = None`, `ref_images: list[Path] = field(default_factory=list)`, `views_count: int = 5`, `width: int = 640`, `height: int = 480`, `seed: int = 42`。
    3. 實作 `build_character_sheet_prompt(spec: CharacterSheetSpec) -> str`：驗證 `5 <= spec.views_count <= 7`（超過 7 視角自動夾限或警告），組裝乾淨英文多視角 Character Sheet Prompt（明確註明 `clean neutral studio background, no 3D mannequin wireframe, no text labels`）。
    4. 實作 `generate_character_sheet(spec: CharacterSheetSpec) -> Path`：
       - 防呆檢查：若 `spec.ref_images` 非空，檢查 `H3_MODEL_DIR / "Ref2VA" / "transformer" / "model.safetensors.index.json"` 是否存在；若本機未安裝 `Ref2VA` 權重，若同時有提供 `first_frame_anchor` 則自動降級走 `FL2VA` (`--first-frame`)，否則拋出清晰 `FileNotFoundError("本地尚未安裝 Ref2VA 權重，請改傳入 first_frame_anchor 或下載 Ref2VA 權重")`。
       - 呼叫 `h3_runner.run_job` 搭配 `DRAFT_AGGRESSIVE`（`--frames 5 --steps 6 --layers 40 --reuse 2`）生成 5 幀暫存 MP4，再用 `ffmpeg` 抽出第 0 幀存為 `spec.output_png`，並刪除暫存 MP4。
  - **立即驗證指令**：
    ```bash
    /usr/bin/python3 -c 'import sys; from pathlib import Path; sys.path.insert(0, "/Users/ysh/Documents/H3C/MiniMax-H3-h3c-ComfyUI"); from h3_character_sheet import CharacterSheetSpec, build_character_sheet_prompt; p = build_character_sheet_prompt(CharacterSheetSpec(subject_desc="Okinawa ceramic Shisa lion-dog", output_png=Path("/tmp/out.png"), views_count=6)); assert "no 3D mannequin" in p and "6" in p; print("P1.4 OK:", p)'
    ```

---

### Phase P2：分鏡雙模接力（`--motion-context` 無損潛空間接力 + Henninges 轉場法，共 4 個微步驟）

- [x] **Micro-Step P2.1：升級 `h3_storyboard_pipeline.py` 的 `run_chained_manifest()` 支援雙模接力與 `--save-context` / `--motion-context`**
  - **目標檔案**：`/Users/ysh/Documents/H3C/MiniMax-H3-h3c-ComfyUI/h3_storyboard_pipeline.py`
  - **讀取切片**：先用 `read_file` 讀取 `StartLine: 375, EndLine: 465`。
  - **實作規格**：
    1. 在 `run_chained_manifest(manifest_path: Path)` 迴圈中，支援每個 segment 設定 `"chain_mode"`:
       - `"motion_context"`（預設推薦之同鏡無損潛空間延續）：第 $N$ 段算圖時自動傳入 `save_context_path = TEMP_DIR / f"{Path(output_prefix).name}_seg{idx}.h3ctx"` 給 `run_h3_direct()`；第 $N+1$ 段若設定 `"use_prev_motion_context": true` 或 `"chain_mode": "motion_context"`，直接將上一段的 `prev_context_path`（或 `prev_video`）作為 `motion_context_path` 傳入 `run_h3_direct(first_frame_path=None, motion_context_path=prev_context_path, ...)`，且此時 `default_trim = 0`（因 `--motion-context` 不會產生九宮格首幀殘留）。
       - `"first_frame"`（向下相容既有模式）：維持 `extract_last_frame(prev_video, ...)` 作為 `first_frame_path`，`default_trim = 1`。
  - **立即驗證指令**：
    ```bash
    /usr/bin/python3 -m py_compile /Users/ysh/Documents/H3C/MiniMax-H3-h3c-ComfyUI/h3_storyboard_pipeline.py
    ```

- [x] **Micro-Step P2.2：升級 ComfyUI 節點 `H3ChainedStoryboardVideo` 支援 `chain_mode` (`motion_context` vs `first_frame`)**
  - **目標檔案**：`/Users/ysh/Documents/H3C/MiniMax-H3-h3c-ComfyUI/ComfyUI/custom_nodes/comfy_h3_bridge/__init__.py`
  - **讀取切片**：先用 `read_file` 讀取 `StartLine: 430, EndLine: 560`。
  - **實作規格**：
    1. 在 `H3ChainedStoryboardVideo.INPUT_TYPES` 的 `"optional"` 加入 `"chain_mode": (["motion_context", "first_frame"], {"default": "motion_context"})`。
    2. 在 `generate_chained()` 中：
       - 若該段 `idx > 1` 且 `(seg.get("chain_mode") or chain_mode) == "motion_context"`，則在 `cmd` 使用 `["--motion-context", str(prev_ctx_or_seg)]` 取代 `["--first-frame", str(first_f)]`，且第 `idx` 段一律加上 `["--save-context", str(run_dir / f"seg_{idx}.h3ctx")]`。
       - 若 `idx == 1`（第一段吃九宮格首幀），仍使用 `--first-frame` 並加上 `--save-context` 供第 2 段接力。
  - **立即驗證指令**：
    ```bash
    /usr/bin/python3 -m py_compile /Users/ysh/Documents/H3C/MiniMax-H3-h3c-ComfyUI/ComfyUI/custom_nodes/comfy_h3_bridge/__init__.py
    ```

- [x] **Micro-Step P2.3：在前端 `film-chain/public/index.html` 分鏡卡加入「分鏡接力模式 (`chain_mode`)」下拉選單**
  - **目標檔案**：`/Users/ysh/Documents/H3C/film-chain/public/index.html`
  - **讀取切片**：先用 `read_file` 讀取 `StartLine: 2920, EndLine: 3005`。
  - **實作規格**：
    1. 在 `appendSegmentCardDOM(seg, idx)` 中（當 `idx > 0` 時），加入 `<select class="seg-chain-mode-select">` 提供兩個選項：
       - `value="motion_context"`：`🔗 潛空間無損延續 (--motion-context PR#76)`（預設選中）
       - `value="first_frame"`：`🖼️ 尾幀像素錨定 (--first-frame I2V)`
    2. 在 `syncSegmentsFromDOM()` 中讀取 `.seg-chain-mode-select` 的值存入 `seg.chain_mode`（第 1 段固定為 `"first_frame"`）。
  - **立即驗證指令**：
    ```bash
    grep -n "seg-chain-mode-select" /Users/ysh/Documents/H3C/film-chain/public/index.html
    ```

- [x] **Micro-Step P2.4：M2 Max 真機雙段 `--save-context` $\to$ `--motion-context` 端到端接力實測**
  - **實測目標**：在 `/Users/ysh/.gemini/antigravity/brain/a607dc47-5c79-456c-80b5-e017b65dce9a/scratch/` 建立一份 2 段式 JSON manifest（`width: 256, height: 256, frames: 25, steps: 4, layers: "40", reuse: 2, render_width: 128, render_height: 128`，Segment 1 使用 `okinawa_shisa_9grid.png`，Segment 2 設定 `"chain_mode": "motion_context"`），以 `BypassSandbox: true` 執行 `h3_storyboard_pipeline.py --chain-manifest`，驗證：
    1. Segment 1 成功產出 `.h3ctx` 潛空間檔與 `.mp4`。
    2. Segment 2 成功讀取 `.h3ctx` 透過 `--motion-context` 完成算圖並由 `ffmpeg` 拼接出最終 `_merged.mp4`。
    3. 測試完成後立即 `rm -rf` 清除 `scratch/` 與測試輸出目錄。

---

### Phase P3：Hunt-then-Finish 斷點續跑與 2D Staging Board 運鏡導引（共 2 個微步驟）

- [x] **Micro-Step P3.1：在 `h3_storyboard_pipeline.py` 新增 `--checkpoint-after-step` 草稿斷點與 `--resume` 完稿續跑支援**
- [x] **Micro-Step P3.2：建立 `h3_staging_board.py`（2D 頂視角機位與角色座標轉 H3 運鏡 Prompt）**

---

### Phase P4：通用 vs 本地架構解耦與品質驗證強化（共 2 個微步驟）

- [x] **Micro-Step P4.1：2D Staging Board 頂視角互動畫布（Universal 通用層：本地/雲端共用）**
  - **檔案**：`film-chain/public/src/core/promptBuilder.js` + `film-chain/public/index.html`
  - **解耦邊界**：純幾何軌跡計算（Dolly In/Out, Pull Back, Orbital Arc, Truck），產出通用的電影級運鏡 Prompt。無論後端是本地 `h3.c` 還是雲端 API（fal.ai, MiniMax API, Seedance），皆能直接作為 `[Camera]` 欄位被精準解析。
  - **驗證**：在 Node.js 中驗證 `compileCameraTrack` 通過，且在前端分鏡卡整合 4 組快速預設與即時畫布拖曳。

- [x] **Micro-Step P4.2：FFmpeg 影片健康審查 Quality Gate 與 Audio Ducking（Universal 通用層）**
  - **檔案**：`MiniMax-H3-h3c-ComfyUI/h3_storyboard_pipeline.py`
  - **實作**：
    1. `verify_video_health(video_path: Path) -> VideoHealthReport`：使用 `ffmpeg -vf blackdetect=d=0.5:pix_th=0.10` 自動檢測渲染或下載的影片是否有壞死黑幀、異常截斷或解碼潰散。
    2. `apply_audio_ducking(video_path, bgm_path, output_path)`：提供標準音訊側鏈混音。
  - **驗證**：使用合成黑幀與彩色幀測試，精準攔截 `black_duration=0.96s` 結構化警告，彩色幀 `is_valid=True`，且工作區暫存檔已完整清理。

---

### Phase P5：範例 Prompt 現代化與程式碼遠端推送（Commit & Push）

- [x] **Micro-Step P5.1：預設範例 Prompt 現代化改造與 Git Push**
  - **目標倉庫**：`h3-studio` (`https://github.com/yshonlytest/h3-studio.git`)
  - **修改內容**：
    1. 徹底替換原先過時且小眾的「沖繩風獅爺拍球雜耍」範例，改為高度標準化、跨雲端/本地通用之「賽博霓虹・雨夜風衣偵探（Neo-Noir Detective）」15 秒連貫三部曲。
    2. 示範完整的 Context-IR 五維度結構（`[Scene]`, `[Camera]`, `Timeline:`, `[Look]`, `Audio:`）、無縫銜接語句、對白標籤（`<d>[Chinese] 看來今晚不會平靜了</d>`）、以及 `chain_mode: "motion_context"`。
    3. 全面更新 Web UI 按鈕（「🎬 電影分鏡範例」）、輸入框 Placeholder、專案預設 Slug 與匯出檔名。
    4. 完成所有修改並通過語法檢查後，已執行 `git add . && git commit -m "..." && git push origin main`（Commit: `ca12339`）。
