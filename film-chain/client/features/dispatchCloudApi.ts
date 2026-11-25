import type { StoryboardSegment } from "../types/studio.ts";
import { STORAGE_KEYS } from "../config/constants.ts";
import { sanitizeUrl } from "../utils/domSafety.ts";
import { formatDiagnosticError, getErrorMessage } from "../utils/errors.ts";
import { computeStore } from "../stores/computeStore.ts";
import { storyboardStore } from "../stores/storyboardStore.ts";
import { escapeHtml, getPrefs, playCompletionChime, showToast } from "./uiShell.ts";
import { syncSegmentsFromDOM } from "./storyboardEditor.ts";
import { mergeAndDownloadCloudClips, renderSegmentsPlaylist } from "./stagePlayer.ts";

export function syncCloudKeyUI(): void {
  const select = document.getElementById("cloudProviderSelect") as HTMLSelectElement | null;
  if (!select) return;
  const prov = select.value;
  const labelEl = document.getElementById("cloudApiKeyLabel");
  const keyInput = document.getElementById("cloudDirectApiKey") as HTMLInputElement | null;
  const badgeEl = document.getElementById("cloudKeyStatusBadge");
  const p = getPrefs();

  let activeKey = "";
  if (prov.startsWith("fal-")) {
    if (labelEl) labelEl.textContent = "🔑 fal.ai API Key";
    if (keyInput) keyInput.placeholder = "請填入 fal.ai API Key (例如 12345678-abcd-...)";
    activeKey = p.falKey;
  } else if (prov === "minimax-official") {
    if (labelEl) labelEl.textContent = "🔑 MiniMax 官方 API Key";
    if (keyInput) keyInput.placeholder = "請填入 MiniMax API Key (例如 eyJhbGci...)";
    activeKey = p.minimaxKey;
  } else {
    if (labelEl) labelEl.textContent = "🔑 雲端 API Key";
    activeKey = p.cloudVideoKey;
  }

  if (keyInput) keyInput.value = activeKey;
  if (badgeEl) {
    if (activeKey) {
      badgeEl.className = "badge ok";
      badgeEl.textContent = "🟢 Key 已就緒";
    } else {
      badgeEl.className = "badge warn";
      badgeEl.textContent = "⚪ 未填寫 Key";
    }
  }
}

export function saveCloudDirectKey(val: string): void {
  const select = document.getElementById("cloudProviderSelect") as HTMLSelectElement | null;
  const prov = select ? select.value : "fal-hailuo";
  const key = val.trim();
  if (prov.startsWith("fal-")) {
    localStorage.setItem(STORAGE_KEYS.FAL_KEY, key);
  } else if (prov === "minimax-official") {
    localStorage.setItem(STORAGE_KEYS.MINIMAX_KEY, key);
  } else {
    localStorage.setItem(STORAGE_KEYS.CLOUD_VIDEO_KEY, key);
  }
  syncCloudKeyUI();
}

export function onCloudProviderChange(_val?: string): void {
  syncCloudKeyUI();
  updateCloudCostEstimate();
}

export function updateCloudCostEstimate(): void {
  const badge = document.getElementById("cloudCostBadge");
  if (!badge || typeof window.H3CloudApiAdapter === "undefined") return;
  const select = document.getElementById("cloudProviderSelect") as HTMLSelectElement | null;
  const prov = select && select.value.startsWith("minimax") ? "minimax" : "fal";
  const segs = syncSegmentsFromDOM();
  const count = segs.length || 3;
  const cost = window.H3CloudApiAdapter.estimateCost(prov, count);
  badge.textContent = `預估消耗：${cost.desc}`;
}

export function showCostConfirmDialog({
  message,
  estimateText,
}: {
  message?: string;
  estimateText?: string;
}): Promise<boolean> {
  const skip = localStorage.getItem(STORAGE_KEYS.SKIP_COST_CONFIRM) === "true";
  if (skip) return Promise.resolve(true);

  return new Promise<boolean>((resolve) => {
    computeStore.patchCompute({ costConfirmPromiseResolve: resolve });
    const msgEl = document.getElementById("costConfirmMessage");
    const estEl = document.getElementById("costConfirmEstimateText");
    if (msgEl && message) msgEl.textContent = message;
    if (estEl && estimateText) estEl.textContent = estimateText;
    const dialog = document.getElementById("costConfirmDialog") as HTMLDialogElement | null;
    if (dialog) dialog.showModal();
    else resolve(true);
  });
}

export function closeCostConfirmDialog(confirmed: boolean): void {
  const dialog = document.getElementById("costConfirmDialog") as HTMLDialogElement | null;
  const dontAsk = document.getElementById("costConfirmDontAskAgain") as HTMLInputElement | null;
  if (dontAsk && dontAsk.checked) {
    localStorage.setItem(STORAGE_KEYS.SKIP_COST_CONFIRM, "true");
  }
  if (dialog && dialog.open) dialog.close();
  const resolver = computeStore.getState().costConfirmPromiseResolve;
  if (resolver) {
    resolver(confirmed);
    computeStore.patchCompute({ costConfirmPromiseResolve: null });
  }
}

export function renderCloudPipelineTracker(segments: StoryboardSegment[]): void {
  const container = document.getElementById("cloudPipelineTrackerContainer");
  const grid = document.getElementById("cloudPipelineGrid");
  if (!container || !grid) return;
  container.style.display = "block";

  grid.innerHTML = segments
    .map(
      (seg, idx) => `
        <div id="cloud-part-card-${idx}" class="pipeline-step-card stage-render" style="min-height:95px;">
          <div class="pipeline-step-num">
            <div style="display:flex; align-items:center; gap:6px;">
              <span class="part-pill">Part ${idx + 1}</span>
              <span class="time-pill">⏱️ ${idx * 5} - ${(idx + 1) * 5}s</span>
            </div>
            <span id="cloud-card-tag-${idx}" class="badge warn" style="font-size:0.68rem; padding:2px 6px;">⏳ 排隊中</span>
          </div>
          <div class="pipeline-step-title" style="font-size:0.82rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(seg.title || "Part " + (idx + 1))}</div>
          <div id="cloud-card-log-${idx}" class="pipeline-step-desc" style="font-size:0.75rem; color:#94a3b8;">等候雲端調度...</div>
          <div id="cloud-card-thumb-${idx}" style="display:none; margin-top:4px;"></div>
        </div>
      `
    )
    .join("");
}

export function cancelCloudVideoStep(): void {
  const controller = computeStore.getState().cloudPipelineAbortController;
  if (controller) {
    controller.abort();
    computeStore.patchCompute({ cloudPipelineAbortController: null });
    showToast("⏹️ 已發送雲端任務中止請求");
  }
}

export async function executeCloudVideoStep(): Promise<void> {
  const segs = syncSegmentsFromDOM();
  if (!segs.length) {
    showToast("⚠️ 請先在步驟一產出或新增至少 1 個分鏡段落");
    return;
  }

  const p = getPrefs();
  const select = document.getElementById("cloudProviderSelect") as HTMLSelectElement | null;
  const providerVal = select ? select.value : "fal-hailuo";
  const chainMode = (document.getElementById("cloudChainModeSelect") as HTMLSelectElement | null)?.value || "strict-last-frame";
  const isParallel = chainMode === "panel-anchor";

  let provider = "fal";
  let apiKey = p.falKey;

  if (providerVal === "minimax-official") {
    provider = "minimax";
    apiKey = p.minimaxKey;
  }

  if (!apiKey) {
    showToast("⚠️ 請先填入對應的雲端 API Key！");
    const keyInput = document.getElementById("cloudDirectApiKey");
    if (keyInput) keyInput.focus();
    return;
  }

  const costEst =
    typeof window.H3CloudApiAdapter !== "undefined"
      ? window.H3CloudApiAdapter.estimateCost(provider, segs.length)
      : { desc: "依調用量計費" };

  const confirmed = await showCostConfirmDialog({
    message: `即將調用 ${providerVal} 發起 ${segs.length} 段分鏡渲染 (${isParallel ? "全並行極速" : "無縫接力"})。`,
    estimateText: costEst.desc,
  });
  if (!confirmed) return;

  const startBtn = document.getElementById("startCloudVideoBtn") as HTMLButtonElement | null;
  const cancelBtn = document.getElementById("cancelCloudVideoBtn");
  if (startBtn) startBtn.disabled = true;
  if (cancelBtn) cancelBtn.style.display = "inline-flex";

  renderCloudPipelineTracker(segs);
  const overallBadge = document.getElementById("cloudOverallStatusBadge");
  if (overallBadge) overallBadge.textContent = "運算進行中 0%";

  const abortController = new AbortController();
  computeStore.patchCompute({ cloudPipelineAbortController: abortController });
  const signal = abortController.signal;

  const { slicedPanelsDataUrls, gridImageDataUrl } = storyboardStore.getState();
  const initialImage = slicedPanelsDataUrls[1] || gridImageDataUrl || "";

  try {
    await window.H3CloudApiAdapter!.runCloudPipeline({
      provider,
      apiKey,
      segments: segs,
      mode: isParallel ? "parallel" : "sequential",
      initialImageUrl: initialImage,
      panelDataUrls: slicedPanelsDataUrls,
      signal,
      onProgress: (idx: number, stage: string, pct: number, message: string) => {
        const card = document.getElementById(`cloud-part-card-${idx}`);
        const tag = document.getElementById(`cloud-card-tag-${idx}`);
        const log = document.getElementById(`cloud-card-log-${idx}`);
        if (card) {
          if (stage === "rendering") card.className = "pipeline-step-card stage-render active-running";
          else if (stage === "completed") card.className = "pipeline-step-card stage-done";
        }
        if (tag) {
          if (stage === "completed") {
            tag.className = "badge ok";
            tag.textContent = "✅ 完成 (5s)";
          } else if (stage === "rendering") {
            tag.className = "badge ok";
            tag.style.borderColor = "#38bdf8";
            tag.style.color = "#7dd3fc";
            tag.textContent = "🎨 渲染中";
          } else if (stage === "extracting") {
            tag.className = "badge warn";
            tag.textContent = "🖼️ 擷取尾幀";
          }
        }
        if (log) log.textContent = message;

        const totalPct = Math.round(((idx + pct / 100) / segs.length) * 100);
        if (overallBadge) overallBadge.textContent = `總進度：${totalPct}%`;
      },
      onSegmentComplete: (idx: number, videoUrl: string) => {
        const thumb = document.getElementById(`cloud-card-thumb-${idx}`);
        const safeVideoUrl = sanitizeUrl(videoUrl, { allowBlob: true, allowRelative: true });
        if (thumb) {
          thumb.style.display = "block";
          thumb.textContent = "";
          if (safeVideoUrl) {
            const videoEl = document.createElement("video");
            videoEl.src = safeVideoUrl;
            videoEl.muted = true;
            videoEl.playsInline = true;
            videoEl.loop = true;
            videoEl.style.width = "100%";
            videoEl.style.maxHeight = "85px";
            videoEl.style.borderRadius = "6px";
            videoEl.style.objectFit = "cover";
            videoEl.style.marginTop = "4px";
            videoEl.addEventListener("mouseover", () => {
              void videoEl.play();
            });
            videoEl.addEventListener("mouseout", () => {
              videoEl.pause();
            });
            thumb.appendChild(videoEl);
          }
        }
        const st = computeStore.getState();
        const nextPlaylist = [...st.currentPlaylist];
        nextPlaylist[idx] = {
          title: segs[idx].title,
          url: videoUrl,
        };
        const nextHistory = { ...st.segmentHistory };
        const segVers = [...(nextHistory[idx] || [])];
        segVers.push({
          version: segVers.length + 1,
          url: videoUrl,
          prompt: segs[idx].prompt,
          panel: segs[idx].end_panel || idx + 1,
        });
        nextHistory[idx] = segVers;
        const nextVer = { ...st.activeVersionIndex, [idx]: segVers.length - 1 };
        computeStore.patchCompute({
          currentPlaylist: nextPlaylist,
          segmentHistory: nextHistory,
          activeVersionIndex: nextVer,
        });
      },
    });

    if (overallBadge) overallBadge.textContent = "✅ 100% 全部完成！";
    showToast("🎉 雲端所有分鏡已生成完成！正在端側自動拼接長片...");
    renderSegmentsPlaylist(computeStore.getState().currentPlaylist);
    await mergeAndDownloadCloudClips(false);
    playCompletionChime();
    document.getElementById("step4Card")?.scrollIntoView({ behavior: "smooth" });
  } catch (err: unknown) {
    const msg = getErrorMessage(err);
    if ((err instanceof Error && err.name === "AbortError") || msg.includes("中止")) {
      showToast("⏹️ 雲端任務已由使用者中止");
    } else {
      showToast(`❌ 雲端生成失敗: ${formatDiagnosticError(err, provider).plainText}`);
    }
  } finally {
    if (startBtn) startBtn.disabled = false;
    if (cancelBtn) cancelBtn.style.display = "none";
    computeStore.patchCompute({ cloudPipelineAbortController: null });
  }
}
