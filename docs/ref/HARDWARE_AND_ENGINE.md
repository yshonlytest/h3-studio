# 硬體、模型與引擎參考（L2，依需求閱讀）

## 實測環境與引擎狀態
- **本機硬體實測規格**：Apple M2 Max (`applegpu_g14s`)，64.0 GiB 統一記憶體，macOS 27.0.1。
- **本地模型權重盤點（`models/MiniMax-H3`）**：
  - ✅ 已安裝：`Qwen3-VL encoder` (62.13 GiB)、`FL2VA DiT` (61.73 GiB)、`video VAE` (9.70 GiB)、`audio VAE` (0.56 GiB)。
  - ✅ 已完成折疊：`MiniMax-H3-Turbo`（利用 APFS CoW clonefile 摺疊 259 個 Turbo LoRA 增量權重，零雙倍空間浪費，支援 5-6 steps 極速原生 Metal 推理）。
  - ✅ 雲端同步：已完成 `pipeline/h3_gdrive_sync.py`，支援 Google Drive 專屬 `H3-Studio` 資料夾快取去重、時間戳防覆蓋、非阻塞異步上傳。
  - ✅ 25 秒仙俠史詩全鏈路實測通過（Verified Ground Truth）：`MiniMax-H3-Turbo` 864×480 (16:9 電影寬螢幕) + 5 段 PR #76 潛空間接力 + Google Drive 自動同步完成。
    - **實測總耗時**：**2 小時 22 分鐘**（單段 5 秒耗時 25～29 分鐘，單 step 耗時約 228s～272s / 3.8～4.5 分鐘）。
    - **記憶體水位**：Resident peak ~33 GiB，純 Resident 零 Swap 震盪，SSD Streaming 保持 5.3～5.5 GiB/s。
    - **產出成品**：`outputs/storyboard_runs/xianxia_aerial_duel_25s_merged_00001_.mp4`（12.2 MB，23.05 秒無黑影格完稿）。
  - ⚠️ 未安裝：`Ref2VA DiT` (0 files，本機實測維持走 `FL2VA` + `--first-frame` 或 PR #76 `--motion-context`)。
- **Code Review 雙軸全數修復（Pass Checklist）**：
  - ✅ `h3.c:649` & `h3.c:660` 對齊：`h3_storyboard_pipeline.py` 遇到 `--checkpoint-after-step` / `--resume` 時自動約束 `reuse=1` 與 `core_reuse=1`，並自動補全 `.ckpt` 輸出路徑。
  - ✅ 消除 Primitive Obsession：引入 `@dataclass(frozen=True) StoryboardJobRequest` 封裝執行參數。
  - ✅ 例外處理修補：淘汰空的 `except ProcessLookupError: pass`，全面改用 `LOGGER.debug` 記錄結構化 Context。
  - ✅ 標籤正則負向環視升級：將 `(?![^>]*>)` 升級為 `(?![^<\n>]*>)`，徹底解決多標籤時的跨標籤漏閉合問題。
  - ✅ 外部 Subprocess 超時保護：所有次要 `ffmpeg` 子行程皆補上 `timeout=30.0` ~ `timeout=120.0` 防鎖定保護。
  - ✅ 前端 Payload 補齊：`comfyPayload.js` 補充節點 `1` 的 `chain_mode` 宣告。
  - ✅ 工作區衛生：自動清除 `ComfyUI/temp/` 殘留之 `.h3ctx` 測試檔。
- **核心 C/Metal 引擎狀態（`engines/h3.c`）**：
  - 分支：`main`（Commit `269f13e`），`./h3` 與 `libh3.a` 已編譯完成並通過 `2002/2002` C 單元測試。
  - 已整合 PR：
    - **PR #2**：`--checkpoint <path>` / `--resume <path>` / `--checkpoint-after-step <K>`
    - **PR #14**：`tools/fold_turbo_lora.py`
    - **PR #35 & #62**：Video VAE 進度回報與 Pipe `fflush(stdout)`
    - **PR #73**：`H3_VAE_PRECISION=bf16|int8`、`H3_VAE_CACHE`、`H3_VAE_PREFETCH=1`（已預設啟用）
    - **PR #76**：`--save-context <file.h3ctx>` / `--motion-context <file.h3ctx|mp4>`（鎖定前鏡末尾 22 幀 Latent + 0.917s 音訊，支援 `FL2VA` 且可與 `--last-frame`、`--ref-image` 共用）

---
