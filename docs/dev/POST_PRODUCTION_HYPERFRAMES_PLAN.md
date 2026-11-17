# 後製合成層規劃（HyperFrames 借鏡）— Optional Compositor

> 參考：[heygen-com/hyperframes](https://github.com/heygen-com/hyperframes)（Agent-Native HTML-to-Video 確定性渲染框架）。
> 定位：**選配後製合成層**，不取代 `h3.c`／Colab 生成管線。僅在需要「精準文字、公式、程式碼高亮、動態圖表、動態字卡」時啟用。
> 觸發條件（滿足任一才走合成層）：教學／知識型長片包裝、需要 KaTeX 公式或程式碼逐行高亮、需要數據圖表動畫、需要 Lower Thirds／Kinetic Typography。

## 0. 架構原則（解耦）

```
生成規格（5D Context-IR / Manifest） ──► h3.c・Colab 生成寫實片段 ──► h3_verifier 驗片
                                                              │
                                          （僅當需要後製包裝時）
                                                              ▼
            合成規格（HTML Composition：video 軌 + 圖表/字卡/字幕軌）──► lint ──► check ──► render
```

- **生成層不動**：`h3.c`、PR #76 尾幀連續性、`h3_state.py` 七態狀態機、Anti-Swap 保護皆保持現狀。
- **合成層新增**：以標準 HTML（`data-composition-id` / `data-start` / `data-duration` / `data-track-index`）描述多軌時間軸；LLM 對 HTML/CSS/GSAP 的語意掌握度遠高於自訂剪輯 JSON。
- **確定性輸出**：禁止螢幕錄影；一律 seek 逐幀推進暫停中的時間軸擷取畫面，再交 FFmpeg 編碼混音。
- **預設不啟用**：純多段 MP4 串接＋靜態硬字幕維持現有 FFmpeg + `h3_subtitles.py` 快速路徑（依賴少、速度快）。

## 1. 微批次清單（H0～H6，依序執行；每步需驗證才打勾）

- [ ] `H0` **ADR：自建 seek-capture vs 直接依賴 HyperFrames CLI**
  - 產出 `docs/adr/ADR-compositor-engine.md`：比較（a）HyperFrames CLI（Node + Headless Chrome 依賴、成熟 lint/check）（b）自建 Playwright seek 擷取（依賴較少、需自寫 lint/check）。
  - 決策門檻：MVP 只做「video 軌＋字卡＋字幕」時可先自建，HyperFrames 留待 H5 升級評估。
  - 驗證：ADR 存在且含決策與被否方案理由；不改任何產品程式碼。
- [ ] `H1` **`pipeline/h3_composition.py`：宣告式時間軸 Schema＋HTML Builder（純邏輯、無瀏覽器）**
  - dataclass(frozen=True)：`CompositionSpec`（id、fps、width/height、tracks）、`VideoTrack`、`OverlayTrack`（titles/lower_third/code/chart/katex）。
  - 產生自包含 HTML（內嵌 GSAP 或 CSS animation），`<video src>` 指向已驗證片段（`outputs/storyboard_runs/` 或 `/api/videos/<file>`）。
  - 單元測試：軌道重疊、時長超出片段、缺欄位皆須報錯。
  - 驗證：`python3 -m unittest tests/test_h3_composition.py && .venv/bin/ruff check pipeline/h3_composition.py`
- [ ] `H2` **`h3_composition_lint`：靜態 Gate（借鏡 `hyperframes lint`）**
  - 檢查：時間軸重疊／負時長／超出總長、安全邊界（safe-area ≥5%）、字級與對比度下限、字幕行長上限（CPS 沿用 `h3_subtitles.py` 規則）。
  - 接入 `h3_cli.py`：`python -m pipeline.h3_cli compose --spec x.json --dry-run`（只 lint 不渲染）。
  - 驗證：`python3 -m unittest tests/test_h3_composition_lint.py`；對既有教學分鏡 dry-run 0 error。
- [ ] `H3` **`h3_composition_check`：渲染期 Headless 檢查（借鏡 `hyperframes check`）**
  - Playwright/Headless Chrome 載入 composition：偵測 overflow（元素超出視口）、文字對比度不足、console error、字型載入失敗。
  - CI 可跳過（`H3_SKIP_BROWSER=1`），本機必須跑。
  - 驗證：故意塞一個超框字卡→回報 error；正常樣板→pass。
- [ ] `H4` **Renderer：seek 逐幀擷取 → FFmpeg 編碼混音**
  - `compose --render`：暫停時間軸逐幀 seek、擷取 PNG 序列 → `ffmpeg -framerate {fps}` 編碼 → 混入 H3 片段原音軌／BGM。
  - 確定性驗收：同一 spec 連跑兩次，輸出 SHA-256 一致（交 `h3_verifier.py` 驗證）；不得掉幀。
  - 輸出唯一落點：`outputs/storyboard_runs/<slug>_composed.mp4`。
  - 驗證：`python3 -m unittest tests/test_h3_composition_render.py`（小尺寸 2s 樣板）。
- [ ] `H5` **教學樣板包（Edu Templates）**
  - 三套：`presenter_chart`（人物 + 動態圖表）、`code_walkthrough`（程式碼逐行高亮）、`data_story`（數字翻牌 + 趨勢線），對接 `h3_edu_profile.py` 場景語意。
  - 產出一支 15s 黃金樣板並通過 H2+H3+H4 全 Gate；樣板納入 `examples/compositions/`。
  - 驗證：`h3_verifier` 通過 + 樣板影片上傳展示區。
- [ ] `H6` **CLI／文件整併與成本門禁**
  - `h3_cli.py` 新增 `compose` 子命令（走既有兩階段授權門禁，渲染前回報預估時間）。
  - 文件：`docs/COMPOSITOR.md`（何時該用／不該用、樣板挑選、故障排除）。
  - 驗證：`python3 -m unittest discover -s tests && .venv/bin/ruff check . && npm test --prefix film-chain`

## 2. 驗收與邊界（防走偏）

- **禁止**：用合成層取代生成管線；把 HyperFrames/Node 依賴塞進 `film-chain/` 前端 bundle；對簡單串接場景預設啟用合成層。
- **字幕策略決策點（H5 再定）**：A 案——沿用 `h3_subtitles.py` 燒錄（相容現況）；B 案——字幕改為 HTML 軌（可動態強調關鍵詞）。預設 A，B 僅在教學樣板驗證後推廣。
- **成本**：合成層為 CPU/GPU 瀏覽器負載，渲染前必須回報預估時間並取得同意（沿用兩階段授權）。
- **可回退**：合成層所有產物另存 `_composed` 後綴，原始 H3 片段永不覆寫。

## 3. 與現有模組對照

| HyperFrames 概念 | 本專案對應 | 狀態 |
|---|---|---|
| Write HTML. Render video. | 新增 `h3_composition.py` + H4 renderer | 規劃中 |
| `hyperframes lint` | `h3_composition_lint`（H2） | 規劃中 |
| `hyperframes check` | `h3_composition_check`（H3，Headless） | 規劃中 |
| declarative timeline | HTML `data-start/duration/track-index` | 規劃中 |
| seek frame-by-frame | H4 確定性 renderer + `h3_verifier` | 規劃中 |
| — | 既有：`h3_prompt_linter`／plan Dry-Run 前置 Gate | 已完成，保留 |
