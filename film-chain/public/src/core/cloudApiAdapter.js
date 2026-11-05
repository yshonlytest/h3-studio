/**
 * H3 Storyboard Studio - cloudApiAdapter.js
 * 商用雲端影片 API 客戶端適配器：支援 fal.ai (Hailuo / Kling) 與 MiniMax 官方直連
 * 純端側調用 + Cloudflare Worker 隱私透傳，免開本機 GPU 與 Colab 算力
 */
(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    root.H3CloudApiAdapter = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ==================== 1. fal.ai Client ====================
  const FalClient = {
    /**
     * 發起 fal.ai 任務
     * @param {Object} params
     * @param {string} params.apiKey
     * @param {string} params.prompt
     * @param {string} params.firstFrameUrl
     * @param {string} [params.model='fal-ai/minimax-video/image-to-video']
     * @param {string} [params.proxyBase='/api/proxy/fal']
     */
    async submitTask({ apiKey, prompt, firstFrameUrl, model = 'fal-ai/minimax-video/image-to-video', proxyBase = '/api/proxy/fal' }) {
      if (!apiKey) throw new Error("缺少 fal.ai API Key");
      if (!prompt) throw new Error("缺少生成 Prompt");

      const endpoint = `${proxyBase.replace(/\/+$/, '')}/${model}`;
      const payload = {
        prompt: prompt,
        image_url: firstFrameUrl || undefined,
      };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Api-Key": apiKey,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || errJson.error || `fal.ai 請求失敗 (${res.status})`);
      }

      const data = await res.json();
      // fal.ai queue 模式會回傳 request_id；若同步模式則可能直接回傳 video.url
      if (data.video && (data.video.url || typeof data.video === 'string')) {
        return { requestId: null, videoUrl: data.video.url || data.video, direct: true };
      }
      const requestId = data.request_id;
      if (!requestId) {
        throw new Error("fal.ai 未回傳有效 request_id");
      }
      return { requestId, data, direct: false };
    },

    /**
     * 輪詢 fal.ai 任務進度
     */
    async pollTask({ apiKey, requestId, model = 'fal-ai/minimax-video/image-to-video', proxyBase = '/api/proxy/fal', onPoll, signal, intervalMs = 2500, maxPolls = 120 }) {
      const statusEndpoint = `${proxyBase.replace(/\/+$/, '')}/${model}/requests/${requestId}/status`;
      const resultEndpoint = `${proxyBase.replace(/\/+$/, '')}/${model}/requests/${requestId}`;

      for (let i = 0; i < maxPolls; i++) {
        if (signal && signal.aborted) throw new Error("使用者中止任務");

        await new Promise(r => setTimeout(r, intervalMs));
        if (signal && signal.aborted) throw new Error("使用者中止任務");

        const res = await fetch(statusEndpoint, {
          method: "GET",
          headers: { "X-User-Api-Key": apiKey },
          signal,
        });

        if (!res.ok) {
          throw new Error(`fal.ai 查詢狀態失敗 (${res.status})`);
        }

        const statusData = await res.json();
        const status = (statusData.status || "").toUpperCase();

        if (onPoll) {
          onPoll({
            status,
            queuePosition: statusData.queue_position,
            logs: statusData.logs || [],
            raw: statusData,
          });
        }

        if (status === "COMPLETED") {
          const resultRes = await fetch(resultEndpoint, {
            method: "GET",
            headers: { "X-User-Api-Key": apiKey },
            signal,
          });
          if (!resultRes.ok) throw new Error("取得 fal.ai 最終影片失敗");
          const resultData = await resultRes.json();
          const videoUrl = resultData.video?.url || (typeof resultData.video === 'string' ? resultData.video : "") || resultData.url;
          if (!videoUrl) throw new Error("fal.ai 結果中未包含有效影片 URL");
          return { videoUrl, resultData };
        }

        if (status === "FAILED") {
          throw new Error(statusData.error || statusData.message || "fal.ai 視頻生成失敗");
        }
      }
      throw new Error("fal.ai 生成超時 (超過 5 分鐘)");
    }
  };

  // ==================== 2. MiniMax 官方 Client ====================
  const MiniMaxClient = {
    /**
     * 發起 MiniMax 官方影片任務
     */
    async submitTask({ apiKey, prompt, firstFrameUrl, model = 'video-01', proxyBase = '/api/proxy/minimax' }) {
      if (!apiKey) throw new Error("缺少 MiniMax API Key");
      if (!prompt) throw new Error("缺少生成 Prompt");

      const endpoint = `${proxyBase.replace(/\/+$/, '')}/video_generation`;
      const payload = {
        prompt,
        model,
        first_frame_image: firstFrameUrl || undefined,
      };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Api-Key": apiKey,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.base_resp?.status_msg || errJson.error || `MiniMax 請求失敗 (${res.status})`);
      }

      const data = await res.json();
      const taskId = data.task_id;
      if (!taskId) {
        throw new Error(data.base_resp?.status_msg || "MiniMax 未回傳有效 task_id");
      }
      return { taskId, data };
    },

    /**
     * 輪詢 MiniMax 官方進度
     */
    async pollTask({ apiKey, taskId, proxyBase = '/api/proxy/minimax', onPoll, signal, intervalMs = 2500, maxPolls = 120 }) {
      const statusEndpoint = `${proxyBase.replace(/\/+$/, '')}/query/video_generation?task_id=${taskId}`;

      for (let i = 0; i < maxPolls; i++) {
        if (signal && signal.aborted) throw new Error("使用者中止任務");

        await new Promise(r => setTimeout(r, intervalMs));
        if (signal && signal.aborted) throw new Error("使用者中止任務");

        const res = await fetch(statusEndpoint, {
          method: "GET",
          headers: { "X-User-Api-Key": apiKey },
          signal,
        });

        if (!res.ok) throw new Error(`MiniMax 查詢狀態失敗 (${res.status})`);
        const data = await res.json();

        if (onPoll) {
          onPoll({
            status: data.status,
            raw: data,
          });
        }

        const status = data.status; // 'Preparing', 'Queueing', 'Processing', 'Success', 'Fail'
        if (status === "Success") {
          const downloadUrl = data.download_url || (data.file_id ? `${proxyBase.replace(/\/+$/, '')}/files/retrieve?file_id=${data.file_id}` : "");
          if (!downloadUrl) throw new Error("MiniMax 生成成功但未取得下載連結");
          return { videoUrl: downloadUrl, data };
        }

        if (status === "Fail") {
          throw new Error(data.base_resp?.status_msg || "MiniMax 視頻生成失敗");
        }
      }
      throw new Error("MiniMax 生成超時 (超過 5 分鐘)");
    }
  };

  // ==================== 3. 端側最後一幀提取器 ====================
  /**
   * 使用 HTML5 Video 與 Canvas 從影片 URL 截取最後一格 (Base64 JPEG)
   * @param {string} videoUrl
   * @returns {Promise<string>}
   */
  async function extractLastFrameFromVideo(videoUrl) {
    if (typeof document === 'undefined') {
      // 測試環境 (Node.js) mock
      return "data:image/jpeg;base64,mock_extracted_last_frame";
    }

    return new Promise((resolve, reject) => {
      const video = document.createElement("video");
      video.crossOrigin = "anonymous";
      video.preload = "auto";
      video.muted = true;
      video.playsInline = true;

      const timer = setTimeout(() => {
        clean();
        reject(new Error("截取影片最後幀超時 (15s)"));
      }, 15000);

      function clean() {
        clearTimeout(timer);
        video.pause();
        video.removeAttribute("src");
        video.load();
      }

      video.onloadedmetadata = () => {
        // seek to duration - 0.05s
        video.currentTime = Math.max(0, video.duration - 0.05);
      };

      video.onseeked = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = video.videoWidth || 1280;
          canvas.height = video.videoHeight || 720;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
          clean();
          resolve(dataUrl);
        } catch (err) {
          clean();
          reject(new Error(`Canvas 讀取最後幀失敗 (跨域限制): ${err.message}`));
        }
      };

      video.onerror = () => {
        clean();
        reject(new Error(`影片載入失敗: ${video.error ? video.error.message : '未知原因'}`));
      };

      video.src = videoUrl;
    });
  }

  // ==================== 4. 費用預估輔助 ====================
  /**
   * 預估雲端 API 調用花費
   * @param {string} provider - 'fal' 或 'minimax'
   * @param {number} segmentCount - 段數 (每段 5 秒)
   */
  function estimateCost(provider, segmentCount) {
    const count = Math.max(1, segmentCount || 1);
    if (provider === 'fal') {
      const perSecCost = 0.03; // fal.ai Hailuo 約 $0.15 / 5s
      const perSegment = 0.15;
      const total = perSegment * count;
      return {
        currency: "USD",
        perSegment: perSegment.toFixed(2),
        total: total.toFixed(2),
        desc: `約 $${total.toFixed(2)} USD (每段 5 秒約 $${perSegment.toFixed(2)})`
      };
    }
    // MiniMax 官方約 0.45 ~ 0.6 RMB / 5s
    const perSegmentRmb = 0.50;
    const totalRmb = perSegmentRmb * count;
    return {
      currency: "RMB",
      perSegment: perSegmentRmb.toFixed(2),
      total: totalRmb.toFixed(2),
      desc: `約 ¥${totalRmb.toFixed(2)} RMB (每段 5 秒約 ¥${perSegmentRmb.toFixed(2)})`
    };
  }

  // ==================== 5. 統一調度流水線 ====================
  /**
   * 執行商用雲端生成管線
   * @param {Object} options
   * @param {'fal'|'minimax'} options.provider
   * @param {string} options.apiKey
   * @param {Array} options.segments - [{ id, prompt, panel_index, title }, ...]
   * @param {'sequential'|'parallel'} options.mode
   * @param {string} options.initialImageUrl
   * @param {Object} [options.panelDataUrls={}] - 9格切片 Base64
   * @param {Function} [options.onProgress] - (partIndex, stage, percent, message) => void
   * @param {Function} [options.onSegmentComplete] - (partIndex, videoUrl) => void
   * @param {AbortSignal} [options.signal]
   */
  async function runCloudPipeline({
    provider = 'fal',
    apiKey,
    segments = [],
    mode = 'sequential',
    initialImageUrl = '',
    panelDataUrls = {},
    onProgress,
    onSegmentComplete,
    signal,
  }) {
    if (!apiKey) throw new Error("請先填入雲端 API Key");
    if (!segments.length) throw new Error("分鏡任務清單為空");

    const results = [];
    const client = provider === 'minimax' ? MiniMaxClient : FalClient;

    // --- Mode A: 並行極速模式 (Parallel) ---
    if (mode === 'parallel') {
      const promises = segments.map(async (seg, idx) => {
        const panelIdx = seg.panel_index || (idx + 1);
        const firstFrame = (panelDataUrls && panelDataUrls[panelIdx]) || initialImageUrl;

        if (onProgress) onProgress(idx, 'submitting', 10, '發起任務中...');
        const submitRes = await client.submitTask({ apiKey, prompt: seg.prompt, firstFrameUrl: firstFrame });

        let videoUrl = "";
        if (submitRes.direct) {
          videoUrl = submitRes.videoUrl;
        } else {
          if (onProgress) onProgress(idx, 'rendering', 30, '生成排隊中...');
          const pollRes = await client.pollTask({
            apiKey,
            requestId: submitRes.requestId,
            taskId: submitRes.taskId,
            signal,
            onPoll: (s) => {
              if (onProgress) onProgress(idx, 'rendering', 60, `渲染中 (${s.status})...`);
            }
          });
          videoUrl = pollRes.videoUrl;
        }

        if (onProgress) onProgress(idx, 'completed', 100, '渲染完成 ✅');
        if (onSegmentComplete) onSegmentComplete(idx, videoUrl);
        return { index: idx, videoUrl };
      });

      return await Promise.all(promises);
    }

    // --- Mode B: 無縫接力模式 (Sequential) ---
    let currentFirstFrame = initialImageUrl || (panelDataUrls && panelDataUrls[1]) || "";

    for (let idx = 0; idx < segments.length; idx++) {
      if (signal && signal.aborted) throw new Error("使用者已中止任務");

      const seg = segments[idx];
      if (onProgress) onProgress(idx, 'submitting', 10, `Part ${idx + 1} 發起任務中...`);

      const submitRes = await client.submitTask({
        apiKey,
        prompt: seg.prompt,
        firstFrameUrl: currentFirstFrame,
      });

      let videoUrl = "";
      if (submitRes.direct) {
        videoUrl = submitRes.videoUrl;
      } else {
        if (onProgress) onProgress(idx, 'rendering', 35, `Part ${idx + 1} 算力佇列中...`);
        const pollRes = await client.pollTask({
          apiKey,
          requestId: submitRes.requestId,
          taskId: submitRes.taskId,
          signal,
          onPoll: (s) => {
            if (onProgress) onProgress(idx, 'rendering', 65, `Part ${idx + 1} 渲染中 (${s.status})...`);
          }
        });
        videoUrl = pollRes.videoUrl;
      }

      if (onProgress) onProgress(idx, 'extracting', 90, `Part ${idx + 1} 擷取銜接尾幀...`);

      // 若非最後一段，提取當前影片最後一格作為下段首格
      if (idx < segments.length - 1) {
        try {
          currentFirstFrame = await extractLastFrameFromVideo(videoUrl);
        } catch (e) {
          console.warn("[CloudAdapter] 提取真實最後幀失敗，降級使用九宮格對應面板:", e);
          const nextPanel = segments[idx + 1].panel_index || (idx + 2);
          currentFirstFrame = (panelDataUrls && panelDataUrls[nextPanel]) || currentFirstFrame;
        }
      }

      if (onProgress) onProgress(idx, 'completed', 100, `Part ${idx + 1} 完成 ✅`);
      if (onSegmentComplete) onSegmentComplete(idx, videoUrl);
      results.push({ index: idx, videoUrl });
    }

    return results;
  }

  return {
    FalClient,
    MiniMaxClient,
    extractLastFrameFromVideo,
    estimateCost,
    runCloudPipeline,
  };
});
