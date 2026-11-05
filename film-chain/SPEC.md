# H3 Storyboard Studio — 系統架構與介面規格書 (SPEC.md)

本文件依據工程規範定義 **H3 Storyboard Studio** 的資料結構、API 合約、Prompt 規格與異常處理機制。

---

## 1. 資料模型與結構規範 (Data Schemas)

### 1.1 AI 劇本與分鏡計畫契約 (`StoryboardPlan`)

由 LLM (Gemini / OpenAI) 在步驟一或步驟二重設產出的結構化 JSON 物件：

```typescript
interface StoryboardPlan {
  project_slug: string;             // 專案英文識別碼 (例: "okinawa_shisa")
  recommended_total_seconds: number;// 建議總秒數，必須為 5 的正整數倍 (例: 15, 20)
  reasoning_zh: string;             // 繁體中文秒數評估與劇情節奏鋪陳理由
  expanded_story_zh: string;        // 擴寫後的繁體中文完整故事大綱
  grid_image_prompt: string;        // 生成 3x3 九宮格的無字邊框英文 Prompt
  segments: StoryboardSegment[];    // 分段分鏡陣列，長度為 recommended_total_seconds / 5
}

interface StoryboardSegment {
  title: string;                    // 繁體中文段落標題與情節說明 (例: "Part 1 (0-5s): 甦醒伸展肩膀...")
  end_panel: number;                // 目標尾幀 Panel 編號 (1 ~ 9 整數，隨段落遞增)
  prompt: string;                   // 英文高密度電影提示詞 (含時間軸、動作、運鏡、首尾連貫語句與對白標籤)
}
```

### 1.2 連貫提示詞規則 (Continuity Rules)

1. **第 1 段 (Part 1, 0-5s)**：
   - 錨定起始視覺，從 Panel 1 或參考圖開場，漸變至 `end_panel`。
2. **第 2 段至第 N 段 (Part $k$, $5(k-1)$s ~ $5k$s)**：
   - 必須嚴格包含連貫前綴：
     `"Create a 5-second live-action cinematic film continuing seamlessly from the exact last frame, pose, camera angle, and lighting of the previous segment..."`
   - 目標對齊該段指定的 `end_panel`。
3. **對白標籤規則**：
   - 若段落包含口白，必須以 `<d>[Chinese] 台詞內容</d>` 包裹，並同時置於時間軸描述（如 `Timeline: 2.0-5.0s...`）與音訊區塊（`Audio: ... spoken dialogue: ...`）。

---

## 2. 外部 API 合約 (External API Contracts)

### 2.1 地端 ComfyUI `/prompt` API 規格

```json
{
  "prompt": {
    "3": {
      "class_type": "LoadImage",
      "inputs": {
        "image": "filename.png"
      },
      "_meta": { "title": "Load 3x3 Storyboard Grid" }
    },
    "1": {
      "class_type": "H3ChainedStoryboardVideo",
      "inputs": {
        "storyboard_grid": ["3", 0],
        "segments_json": "[ { \"title\": \"...\", \"end_panel\": 3, \"prompt\": \"...\" } ]",
        "width": 640,
        "height": 480,
        "frames": 81,
        "steps": 12,
        "layers": 16,
        "reuse": 2,
        "core_reuse": 1,
        "token_reduction": 0.2,
        "render_width": 640,
        "render_height": 480,
        "seed": 42,
        "ssd_streaming": true
      },
      "_meta": { "title": "H3 Chained Storyboard Video" }
    },
    "2": {
      "class_type": "SaveVideo",
      "inputs": {
        "filename_prefix": "project_slug/project_slug_15s_story",
        "format": "mp4",
        "format.codec": "auto",
        "codec": "auto",
        "video": ["1", 0]
      },
      "_meta": { "title": "Save Final Merged Video" }
    }
  }
}
```

### 2.2 雲端 API 調用契約 (Cloud Video APIs)

- **ByteDance Ark / Seedance** (`/contents/generations/tasks`):
  - 任務建立：傳入 `first_frame` 與 `last_frame` 之 base64 或公網 URL，帶入 `--duration 5` 與 prompt。
  - 輪詢機制：每 4 秒輪詢任務狀態，遇 `succeeded` 取得 `video_url`。
- **fal.ai** (`queue.fal.run`):
  - 傳入 `image_url` (首幀) 與 `end_image_url` (尾幀)。

---

## 3. 網路異常與 CORS 診斷協議 (Diagnostics Protocol)

當瀏覽器發起 `fetch` 遇到網路失敗、CORS 阻擋或金鑰失效時，必須提供精確診斷建議：

| 錯誤類型 | 檢測特徵 | 診斷回報與引導動作 |
| :--- | :--- | :--- |
| **ComfyUI 未啟動 / 連線被拒** | `Failed to fetch` 且 URL 包含 `8188` | 提示「本地 ComfyUI 服務尚未開啟」，建議在終端機執行或雙擊 `一鍵啟動_H3分鏡工作坊.command`。 |
| **ComfyUI 跨域阻擋 (CORS)** | `TypeError: Failed to fetch` | 提醒 ComfyUI 啟動參數需加上 `--enable-cors-header "*"`。 |
| **Gemini / OpenAI API 401/403** | `status === 401 || status === 403` | 提示「API Key 無效或額度不足」，自動引導點擊齒輪或頂部安全卡片重設。 |
| **雲端 API CORS 限制** | 呼叫第三方直接端點被瀏覽器封鎖 | 引導切換至提供 CORS 標頭之 API 代理或使用地端工作流。 |
