# H3 Storyboard Studio — 領域術語辭典 (Ubiquitous Language)

本文件依據領域驅動設計 (Domain-Driven Design, DDD) 與軟體工程規範，定義 **H3 Storyboard Studio** 專案的核心領域術語與模型名稱。所有前後端模組、Prompt 生成器、設定檔與 UI 介面均必須遵循此一致語彙。

---

## 1. 核心實體與結構 (Core Entities)

| 術語 (Term) | 英文代碼 (Code / Key) | 定義與職責 |
| :--- | :--- | :--- |
| **九宮格分鏡圖** | `Storyboard Grid` / `9-Grid` | 一張由 3×3（共 9 格 Panel）組成的單張影像，作為視覺錨點（Anchor），供影片模型擷取關鍵影格。內部嚴格禁止任何文字或標題以避免模型混淆。 |
| **分鏡格** | `Panel (1~9)` | 九宮格內的個別小圖，編號由左至右、由上至下（Row 1: 1, 2, 3; Row 2: 4, 5, 6; Row 3: 7, 8, 9）。 |
| **分段影片** | `Chained Segment` | 以 5 秒為固定基本單元（5s Chunk）的影片片段。第 $n$ 個分段的時長固定為 5 秒，時序為 $[(n-1)\times 5 \text{s}, n\times 5 \text{s}]$。 |
| **首尾連貫提示詞** | `Continuity Prompt` | 賦予影片生成模型嚴格連貫性的提示詞。第 2 段至第 $N$ 段開頭必須強制注入：`"Create a 5-second live-action cinematic film continuing seamlessly from the exact last frame, pose, camera angle, and lighting of the previous segment..."`。 |
| **對白口型標籤** | `Dialogue Tag` | 格式為 `<d>[Chinese] 台詞內容</d>`。當分段包含對話時，提示詞同時在時間軸和音訊欄位標記此標籤，以觸發 H3/Seedance 的擬真口型與真實語音。 |
| **預設方案** | `Default Preset` | 以沖繩風獅爺（Okinawa Shisa）雜耍苦瓜為代表的驗證基準配置，包含原圖、3x3 九宮格、15 秒分鏡腳本、3 段分段影片以及 1 支完整合併 MP4。 |

---

## 2. 產製路線與分流 (Execution Routes)

| 術語 (Term) | 英文代碼 | 說明 |
| :--- | :--- | :--- |
| **路線 A：地端工作流** | `Route A: Local ComfyUI` | 本地運行 ComfyUI，透過自定義節點 `H3ChainedStoryboardVideo` 接收九宮格與各段 Prompt，直接於本地顯卡 (如 Mac/Metal) 渲染並合併影片。 |
| **路線 B：雲端極速流** | `Route B: Cloud API` | 透過第三方雲端服務（如 ByteDance Ark / Seedance 或 fal.ai）買額度直接調用首尾影格控制模型，由瀏覽器並行發出請求取得各段影片。 |
| **純前端一鍵合併** | `In-Browser Canvas Merge` | 雲端模式下各段影片產出後，純利用瀏覽器 `HTML5 Canvas` 與 `MediaRecorder` 在本地記憶體串接各段畫面，輸出完整無縫 WebM/MP4，不經伺服器且不外洩資料。 |

---

## 3. 系統生命週期與步驟 (Workflow Steps)

1. **安全配置與金鑰設定 (Security & Configuration)**
   - API Key 僅儲存於瀏覽器 `localStorage`，絕不上傳遠端伺服器。
2. **步驟一：AI 劇本分析與九宮格產出 (Script Planning & Grid Generation)**
   - 載入人物/風格參考圖，輸入中文情節描述，由 LLM (Gemini / GPT) 自動規劃 $5n$ 秒分鏡腳本並生成 3x3 九宮格。
3. **步驟二：分鏡腳本檢視與時間軸微調 (Storyboard & Prompt Review)**
   - 頂部展示九宮格與各格 Panel 切割預覽；下方檢視每段 5 秒的繁體中文標題、目標尾幀 (Panel 1~9，附迷你九宮格視覺指標) 與英文連貫提示詞，支援手動增減段落與「AI 重設分鏡建議」。
4. **步驟三：多段影片生成 (Video Generation)**
   - 依路線選擇執行：地端呼叫 ComfyUI 佇列，或雲端並行調用首尾幀影片模型。
5. **步驟四：影片播放、無縫連播與成果匯出 (Playback & Merging)**
   - 依序展示各段 5 秒影片清單與一鍵前端合併按鈕，末尾提供完整總片播放器與高畫質下載。
