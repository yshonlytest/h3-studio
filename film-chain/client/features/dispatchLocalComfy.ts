import type { SpeedConfig, StoryboardSegment } from "../types/studio.ts";
import { getErrorMessage } from "../utils/errors.ts";
import { SHISA_DEFAULT_CONFIG, SPEED_CONFIGS } from "../data/templates.ts";
import { computeStore } from "../stores/computeStore.ts";
import { storyboardStore } from "../stores/storyboardStore.ts";
import { escapeHtml, getPrefs, showToast, updateLocalRenderEstimateUI } from "./uiShell.ts";
import { syncSegmentsFromDOM } from "./storyboardEditor.ts";
import { playVideoInStage, renderSegmentsPlaylist } from "./stagePlayer.ts";

export async function checkComfyConnection(): Promise<boolean> {
  const badge = document.getElementById("comfyStatusBadge");
  const engineEl = document.getElementById("localDetectedEngineBadge");
  const { comfyUrl } = getPrefs();
  updateLocalRenderEstimateUI();

  const envApi = window.H3LocalEnv;
  if (envApi && envApi.checkNow && (await envApi.checkNow())) {
    computeStore.setDetectedLocalEngine("metal");
    if (badge) {
      badge.className = "badge ok";
      badge.textContent = "🟢 本機 H3 Metal 已連線 (8080)";
    }
    if (engineEl) {
      engineEl.innerHTML =
        '🟢 當前選用引擎：<strong style="color:#6ee7b7;">H3 Metal 原生守護進程 (127.0.0.1:8080)</strong>';
    }
    return true;
  }
  try {
    const res = await fetch(`${comfyUrl}/system_stats`, { method: "GET" });
    if (res.ok) {
      computeStore.setDetectedLocalEngine("comfy");
      if (badge) {
        badge.className = "badge ok";
        badge.textContent = `🟢 本地 ComfyUI 已連線 (${comfyUrl})`;
      }
      if (engineEl) {
        engineEl.innerHTML = `🟡 當前選用引擎：<strong style="color:#fcd34d;">ComfyUI 節點排程 (${escapeHtml(comfyUrl)})</strong>`;
      }
      return true;
    }
  } catch (err) {
    console.debug("ComfyUI check offline:", err);
  }
  computeStore.setDetectedLocalEngine("none");
  if (badge) {
    badge.className = "badge warn";
    badge.textContent = "⚪ 本機 H3 (8080) / ComfyUI (8188) 未啟動 (點此重試)";
  }
  if (engineEl) {
    engineEl.innerHTML =
      '⚪ 引擎狀態：<span style="color:#fca5a5;">未偵測到 8080 或 8188 服務（請先執行 ./scripts/start_studio.sh）</span>';
  }
  return false;
}

export function buildComfyApiPrompt(
  uploadedGridFilename: string,
  segments: StoryboardSegment[],
  speedCfg: SpeedConfig,
  outputPrefix: string
): Record<string, unknown> {
  if (typeof window.H3ComfyPayload !== "undefined" && window.H3ComfyPayload.buildComfyApiPrompt) {
    return window.H3ComfyPayload.buildComfyApiPrompt(
      uploadedGridFilename,
      segments,
      speedCfg,
      outputPrefix,
      SHISA_DEFAULT_CONFIG
    );
  }
  return {
    "3": {
      class_type: "LoadImage",
      inputs: { image: uploadedGridFilename },
      _meta: { title: "Load 3x3 Storyboard Grid" },
    },
    "1": {
      class_type: "H3ChainedStoryboardVideo",
      inputs: {
        storyboard_grid: ["3", 0],
        segments_json: JSON.stringify(segments, null, 2),
        width: SHISA_DEFAULT_CONFIG.width,
        height: SHISA_DEFAULT_CONFIG.height,
        frames: SHISA_DEFAULT_CONFIG.frames,
        steps: speedCfg.steps,
        layers: speedCfg.layers,
        reuse: speedCfg.reuse,
        core_reuse: speedCfg.core_reuse,
        token_reduction: speedCfg.token_reduction,
        render_width: speedCfg.render_width,
        render_height: speedCfg.render_height,
        seed: SHISA_DEFAULT_CONFIG.seed,
        ssd_streaming: true,
      },
      _meta: { title: "H3 Chained Storyboard Video" },
    },
    "2": {
      class_type: "SaveVideo",
      inputs: {
        filename_prefix: outputPrefix,
        format: "mp4",
        "format.codec": "auto",
        codec: "auto",
        video: ["1", 0],
      },
      _meta: { title: "Save Final Merged Video" },
    },
  };
}

export function downloadComfyWorkflowJson(): void {
  const segs = syncSegmentsFromDOM();
  const selectedSpeed = computeStore.getState().selectedSpeed;
  const currentPlan = storyboardStore.getState().currentPlan;
  const speedCfg = SPEED_CONFIGS[selectedSpeed];
  const slug = currentPlan?.project_slug || "story_project";
  const gridName = currentPlan?.grid_image_name || "demo_9grid.png";
  const apiPrompt = buildComfyApiPrompt(gridName, segs, speedCfg, `${slug}/${slug}_${segs.length * 5}s_story`);
  const blob = new Blob([JSON.stringify(apiPrompt, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${slug}_${segs.length * 5}s_comfy_api.json`;
  a.click();
}

export function lintH3PromptText(rawPrompt: string): string {
  let fixed = String(rawPrompt || "").replace(/<(Picture|Video|Audio)\s+(\d+)(?![^<\n>]*>)/gi, (_m, tag: string, num: string) => {
    const cap = tag.charAt(0).toUpperCase() + tag.slice(1).toLowerCase();
    return `<${cap} ${parseInt(num, 10)}>`;
  });
  fixed = fixed.replace(/<\s*picture\s*(\d+)\s*>/gi, (_m, num: string) => `<Picture ${parseInt(num, 10)}>`);
  return fixed.trim();
}

export function describeH3StageFromPct(pct: number): string {
  if (pct < 22) return "階段 1/3：Qwen3-VL 文本編碼與語意對齊中...";
  if (pct < 85) return "階段 2/3：Metal DiT 潛空間去噪生成中...";
  return "階段 3/3：BF16 Video VAE 解碼與 FFmpeg 封裝中...";
}

export function connectComfyProgressWs(comfyUrl: string, clientId: string): void {
  const prevWs = computeStore.getState().comfyActiveWs;
  if (prevWs) {
    try {
      prevWs.close();
    } catch (err) {
      console.warn("WS close warning:", err);
    }
  }
  const wsUrl = `${comfyUrl.replace(/^http/i, "ws")}/ws?clientId=${encodeURIComponent(clientId)}`;
  const ws = new WebSocket(wsUrl);
  ws.onmessage = (evt) => {
    if (typeof evt.data !== "string") return;
    try {
      const msg = JSON.parse(evt.data);
      if (msg.type === "progress" && msg.data && msg.data.max > 0) {
        const pct = Math.min(99, Math.max(1, Math.round((msg.data.value / msg.data.max) * 100)));
        const bar = document.getElementById("jobProgressBar");
        const pctEl = document.getElementById("jobPercentText");
        const stageEl = document.getElementById("jobStageText");
        if (bar) bar.style.width = `${pct}%`;
        if (pctEl) pctEl.textContent = `${pct}%`;
        if (stageEl) stageEl.textContent = describeH3StageFromPct(pct);
      }
    } catch (err) {
      console.warn("Comfy WS parse warning:", err);
    }
  };
  computeStore.patchCompute({ comfyActiveWs: ws });
}

export async function cancelLocalComfyJob(): Promise<void> {
  const { comfyUrl } = getPrefs();
  const { comfyPollTimer, comfyActiveWs } = computeStore.getState();
  if (comfyPollTimer) clearInterval(comfyPollTimer);
  if (comfyActiveWs) {
    try {
      comfyActiveWs.close();
    } catch (err) {
      console.warn("WS close warning:", err);
    }
  }
  computeStore.patchCompute({ comfyPollTimer: null, comfyActiveWs: null });
  try {
    await fetch(`${comfyUrl}/interrupt`, { method: "POST" });
  } catch (err) {
    console.warn("Comfy interrupt request warning:", err);
  }
  const stageEl = document.getElementById("jobStageText");
  const pctEl = document.getElementById("jobPercentText");
  const cancelBtn = document.getElementById("cancelLocalJobBtn");
  const startBtn = document.getElementById("startLocalVideoBtn") as HTMLButtonElement | null;
  if (stageEl) stageEl.textContent = "🛑 已強制中斷本地算圖（Process Group 與未完成暫存 MP4 已自動清理）";
  if (pctEl) pctEl.textContent = "已中斷";
  if (cancelBtn) cancelBtn.style.display = "none";
  if (startBtn) startBtn.disabled = false;
}

export function renderLocalPipelineTracker(segs: StoryboardSegment[], engineName: string): void {
  const grid = document.getElementById("localPipelineGrid");
  if (!grid) return;
  grid.style.display = "grid";
  grid.innerHTML = segs
    .map(
      (s, idx) => `
        <div id="local-part-card-${idx}" class="pipeline-step-card stage-render ${idx === 0 ? "active-running" : ""}">
          <div class="pipeline-step-header">
            <span class="pipeline-step-title">🎬 Part ${idx + 1} (${idx * 5}-${(idx + 1) * 5}s)</span>
            <span id="local-card-tag-${idx}" class="badge ${idx === 0 ? "ok" : ""}">${idx === 0 ? "運算中" : "等待中"}</span>
          </div>
          <div class="pipeline-step-desc">${escapeHtml(s.title || `分段 ${idx + 1}`)} · 引擎：${escapeHtml(engineName)}</div>
        </div>
      `
    )
    .join("");
}

export async function executeLocalComfyStep(): Promise<void> {
  const segs = syncSegmentsFromDOM().map((s) => ({ ...s, prompt: lintH3PromptText(s.prompt) }));
  if (!segs.length) {
    showToast("⚠️ 請先在步驟一產出或新增至少 1 個分鏡段落");
    return;
  }

  const envApi = window.H3LocalEnv;
  const metalOnline = envApi && envApi.checkNow ? await envApi.checkNow() : false;
  if (metalOnline && envApi && envApi.startRender) {
    renderLocalPipelineTracker(segs, "H3 Metal (8080)");
    showToast(`🚀 已連線 H3 Metal 原生守護進程 (8080)，開始渲染共 ${segs.length} 段分鏡`);
    const started = await envApi.startRender();
    if (started) return;
    showToast("⚠️ Metal 守護進程拒絕渲染，改嘗試 ComfyUI 排程...");
  }

  const { comfyUrl } = getPrefs();
  const isOnline = await checkComfyConnection();
  if (!isOnline) {
    const diag =
      typeof window.H3CloudDiagnostics !== "undefined"
        ? window.H3CloudDiagnostics.diagnoseNetworkError(new Error("ComfyUI offline"), { url: comfyUrl, service: "comfyui" })
        : null;
    showToast(`❌ ${diag ? diag.title : "無法連線至本機 H3 (8080) 或 ComfyUI (8188)"}：請先執行 ./scripts/start_studio.sh`);
    return;
  }

  renderLocalPipelineTracker(segs, `ComfyUI (${comfyUrl})`);
  showToast(`🟡 8080 未啟動，已自動切換至 ComfyUI (${comfyUrl}) 排程渲染`);

  const startBtn = document.getElementById("startLocalVideoBtn") as HTMLButtonElement | null;
  const cancelBtn = document.getElementById("cancelLocalJobBtn");
  if (startBtn) startBtn.disabled = true;
  if (cancelBtn) cancelBtn.style.display = "inline-block";

  try {
    const { currentPlan, gridImageBlob } = storyboardStore.getState();
    const { selectedSpeed, comfyPollTimer: prevTimer } = computeStore.getState();

    let uploadedGridName = currentPlan?.grid_image_name || SHISA_DEFAULT_CONFIG.grid_image_name;
    if (gridImageBlob) {
      const form = new FormData();
      form.append("image", gridImageBlob, `studio_9grid_${Date.now()}.png`);
      form.append("overwrite", "true");
      const upRes = await fetch(`${comfyUrl}/upload/image`, { method: "POST", body: form });
      if (upRes.ok) {
        const upData = await upRes.json();
        uploadedGridName = upData.name;
      }
    }

    const clientId = `h3studio_${Date.now()}`;
    connectComfyProgressWs(comfyUrl, clientId);

    const speedCfg = SPEED_CONFIGS[selectedSpeed];
    const slug = currentPlan?.project_slug || "story_project";
    const outputPrefix = `${slug}/${slug}_${segs.length * 5}s_story`;
    const apiPrompt = buildComfyApiPrompt(uploadedGridName, segs, speedCfg, outputPrefix);

    const qRes = await fetch(`${comfyUrl}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: apiPrompt, client_id: clientId }),
    });
    if (!qRes.ok) throw new Error(`ComfyUI /prompt 錯誤: ${await qRes.text()}`);
    const qData = await qRes.json();
    const promptId = qData.prompt_id;

    const panelEl = document.getElementById("jobProgressPanel");
    const barEl = document.getElementById("jobProgressBar");
    const pctEl = document.getElementById("jobPercentText");
    const stageEl = document.getElementById("jobStageText");
    if (panelEl) panelEl.style.display = "block";
    if (barEl) barEl.style.width = "5%";
    if (pctEl) pctEl.textContent = "5%";
    if (stageEl) stageEl.textContent = `🟡 [ComfyUI 8188] 佇列執行中 (共 ${segs.length} 段 / ${segs.length * 5} 秒)...`;
    const startTime = Date.now();
    const estTotalSec = segs.length * (selectedSpeed === "balanced" ? 1080 : selectedSpeed === "fast" ? 120 : 360);

    if (prevTimer) clearInterval(prevTimer);
    const pollTimer = setInterval(async () => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const timerBadge = document.getElementById("jobTimerBadge");
      if (timerBadge) {
        timerBadge.textContent = `⏱️ 本地執行 ${Math.floor(elapsed / 60)}分 ${elapsed % 60}秒`;
      }
      const activeSegIdx = Math.min(segs.length - 1, Math.floor((elapsed / Math.max(1, estTotalSec)) * segs.length));
      segs.forEach((_, idx) => {
        const c = document.getElementById(`local-part-card-${idx}`);
        const t = document.getElementById(`local-card-tag-${idx}`);
        if (!c || !t) return;
        if (idx < activeSegIdx) {
          c.className = "pipeline-step-card stage-render stage-done";
          t.textContent = "✅ 已完成";
        } else if (idx === activeSegIdx) {
          c.className = "pipeline-step-card stage-render active-running";
          t.textContent = "🎨 渲染中";
        }
      });
      try {
        const hRes = await fetch(`${comfyUrl}/history/${promptId}`);
        if (!hRes.ok) return;
        const hist = await hRes.json();
        if (hist[promptId]) {
          const { comfyPollTimer: activeTimer, comfyActiveWs: activeWs } = computeStore.getState();
          if (activeTimer) clearInterval(activeTimer);
          if (activeWs) {
            try {
              activeWs.close();
            } catch (err) {
              console.warn("WS close warning:", err);
            }
          }
          computeStore.patchCompute({ comfyPollTimer: null, comfyActiveWs: null });
          if (cancelBtn) cancelBtn.style.display = "none";
          const outputs = hist[promptId].outputs || {};
          const collectedVideos: Array<{ title: string; url: string; filename: string; subfolder: string }> = [];
          for (const nodeId of Object.keys(outputs)) {
            const nodeOut = outputs[nodeId];
            const items = nodeOut.videos || nodeOut.gifs || nodeOut.images || [];
            items.forEach((vid: { filename: string; subfolder?: string; type?: string }) => {
              const viewUrl = `${comfyUrl}/view?filename=${encodeURIComponent(vid.filename)}&subfolder=${encodeURIComponent(vid.subfolder || "")}&type=${encodeURIComponent(vid.type || "output")}`;
              collectedVideos.push({
                title: segs[collectedVideos.length]?.title || `輸出片段 ${collectedVideos.length + 1} (${vid.filename})`,
                url: viewUrl,
                filename: vid.filename,
                subfolder: vid.subfolder || "",
              });
            });
          }
          segs.forEach((_, idx) => {
            const c = document.getElementById(`local-part-card-${idx}`);
            const t = document.getElementById(`local-card-tag-${idx}`);
            if (c) c.className = "pipeline-step-card stage-render stage-done";
            if (t) t.textContent = "✅ 已完成";
          });
          if (collectedVideos.length > 0) {
            if (barEl) barEl.style.width = "100%";
            if (stageEl) stageEl.textContent = `✅ 本地影片生成完成（共取得 ${collectedVideos.length} 個影片檔）！`;
            if (pctEl) pctEl.textContent = "100%";
            if (collectedVideos.length > 1) {
              renderSegmentsPlaylist(collectedVideos);
            }
            const lastVid = collectedVideos[collectedVideos.length - 1];
            playVideoInStage(lastVid.url, `🎬 ${lastVid.subfolder ? lastVid.subfolder + "/" : ""}${lastVid.filename}`);
            showToast("✅ 本地影片渲染完成！可前往步驟四預覽");
          }
          if (startBtn) startBtn.disabled = false;
        }
      } catch (err) {
        console.warn("History poll warning:", err);
      }
    }, 3000);
    computeStore.patchCompute({ comfyPollTimer: pollTimer });
  } catch (err: unknown) {
    if (cancelBtn) cancelBtn.style.display = "none";
    showToast(`❌ 執行失敗：${getErrorMessage(err)}`);
    if (startBtn) startBtn.disabled = false;
  }
}
