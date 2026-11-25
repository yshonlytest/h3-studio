import type { StoryboardPlan, StoryboardSegment } from "../types/studio.ts";
import { STORAGE_KEYS } from "../config/constants.ts";
import { coreStore } from "../stores/coreStore.ts";
import { computeStore } from "../stores/computeStore.ts";
import { storyboardStore } from "../stores/storyboardStore.ts";
import { escapeHtml, fallbackCopyText, playCompletionChime, showToast } from "./uiShell.ts";
import { exportChainedManifest, syncSegmentsFromDOM } from "./storyboardEditor.ts";
import { playVideoInStage } from "./stagePlayer.ts";

let isRenderingColabTracker = false;

export function getOrCreateSessionId(): string {
  let sid = coreStore.getState().currentSessionId;
  if (sid) return sid;
  const hashMatch = window.location.hash.match(/session=([a-zA-Z0-9_-]+)/);
  if (hashMatch && hashMatch[1]) {
    sid = hashMatch[1];
    coreStore.setSessionId(sid);
    localStorage.setItem(STORAGE_KEYS.SESSION_ID, sid);
    return sid;
  }
  const saved = localStorage.getItem(STORAGE_KEYS.SESSION_ID);
  if (saved && saved.startsWith("fc_")) {
    coreStore.setSessionId(saved);
    return saved;
  }
  const d = new Date();
  const dateStr = d.toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.random().toString(36).substring(2, 8);
  sid = `fc_${dateStr}_${rand}`;
  coreStore.setSessionId(sid);
  localStorage.setItem(STORAGE_KEYS.SESSION_ID, sid);
  window.location.hash = `session=${sid}`;
  return sid;
}

export interface SegmentTimeRange {
  startS: number;
  endS: number;
  durationSec: number;
}

export function computeSegmentTimeRanges(
  segments: ReadonlyArray<Partial<StoryboardSegment>>,
  isEdu: boolean
): { ranges: SegmentTimeRange[]; totalSec: number } {
  const count = segments.length;
  let runningSec = 0;
  const ranges: SegmentTimeRange[] = segments.map((seg) => {
    if (typeof window !== "undefined" && typeof window.H3TimecodeHelper?.resolveSegmentTiming === "function") {
      const t = window.H3TimecodeHelper.resolveSegmentTiming(seg, runningSec, isEdu);
      const startS = typeof t.startSec === "number" ? t.startSec : runningSec;
      const endS = t.endSec;
      const durationSec = typeof t.durationSec === "number" ? t.durationSec : Math.round((endS - startS) * 10) / 10;
      runningSec = endS;
      return { startS, endS, durationSec };
    }
    const timeMatch = (seg.title || "").match(/\((\d+(?:\.\d+)?)[-~](\d+(?:\.\d+)?)s\)/);
    let startS = runningSec;
    let endS = runningSec + 5;
    let durationSec = 5.0;
    if (timeMatch) {
      startS = parseFloat(timeMatch[1]);
      endS = parseFloat(timeMatch[2]);
      durationSec = Math.round((endS - startS) * 10) / 10;
      runningSec = endS;
    } else {
      runningSec += 5.0;
    }
    return { startS, endS, durationSec };
  });
  const totalSec = count === 0 ? 0 : Math.round(runningSec) || count * 5;
  return { ranges, totalSec };
}

export function buildColabCompatibleManifest(): Record<string, any> {
  const segs = syncSegmentsFromDOM(true);
  const currentPlan = storyboardStore.getState().currentPlan;
  const activeProjectMode = coreStore.getState().activeProjectMode;
  const activeRoute = computeStore.getState().activeRoute;
  const plan: Partial<StoryboardPlan> = currentPlan || { project_slug: "story_project", segments: [] };
  const effectiveSegs = segs.length > 0 ? segs : plan.segments || [];
  const count = effectiveSegs.length;
  const slug = plan.project_slug || "film_chain_story";
  const isEdu = activeProjectMode === "edu" || plan.project_mode === "edu_explainer";
  const chained = exportChainedManifest(true);
  const defaultRef = (chained && chained.anchor_ref_image) || plan.anchor_ref_image || "examples/assets/detective_anchor_ref.jpg";
  const { ranges: segmentRanges, totalSec } = computeSegmentTimeRanges(effectiveSegs, isEdu);

  const jobs = effectiveSegs.map((seg: Partial<StoryboardSegment> & { first_frame?: string }, idx: number) => {
    const dur = segmentRanges[idx]?.durationSec ?? 5.0;
    const segRef = seg.first_frame || defaultRef;
    return {
      id: `${slug}_part${idx + 1}`,
      title: seg.title || `Part ${idx + 1}`,
      duration_seconds: dur,
      end_panel: seg.end_panel || 9,
      reference_images: segRef ? [segRef] : [],
      output_name: `tutorial_part${idx + 1}`,
      source_shot_id: idx + 1,
      prompt: seg.prompt || "",
      seed: 20260931 + idx,
    };
  });
  const sid = getOrCreateSessionId();
  const targetSegs = chained && chained.segments ? chained.segments : effectiveSegs;
  const handoffMeta =
    typeof window.H3TimecodeHelper !== "undefined" && typeof window.H3TimecodeHelper.buildHandoffMetadata === "function"
      ? window.H3TimecodeHelper.buildHandoffMetadata({ projectSlug: slug, sessionId: sid, segments: targetSegs, totalSeconds: totalSec })
      : {
          schema_version: "h3.storyboard_handoff.v2",
          session_id: sid,
          revision: "rev_00000000",
          segment_count: count,
          total_seconds: totalSec,
          delivery_mode: count <= 6 ? "inline_payload" : "manifest_file",
        };
  const routeGpu = activeRoute === "local" ? "Apple_Silicon_Metal" : activeRoute === "saas_api" ? "SaaS_Cloud_API" : "L4";

  return {
    ...(chained || {}),
    schema_version: handoffMeta.schema_version,
    session_id: handoffMeta.session_id,
    revision: handoffMeta.revision,
    delivery_mode: handoffMeta.delivery_mode,
    project: slug,
    total_seconds: totalSec,
    segment_count: count,
    skill: "h3-studio",
    gpu: routeGpu,
    jobs,
    segments: targetSegs,
  };
}

export async function publishSessionManifestAndImage(): Promise<{ ok: boolean; manifest: Record<string, any> }> {
  const sid = getOrCreateSessionId();
  const manifest = buildColabCompatibleManifest();
  const dot = document.getElementById("sessionStatusDot");
  const text = document.getElementById("sessionStatusText");
  const idEl = document.getElementById("sessionStatusId");
  if (idEl) idEl.textContent = sid;

  try {
    const mRes = await fetch(`/api/session/${sid}/manifest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(manifest),
    });
    if (!mRes || !mRes.ok) {
      throw new Error(`Relay HTTP ${mRes ? mRes.status : "unreachable"}`);
    }

    const refPreview = document.getElementById("refPreview") as HTMLImageElement | null;
    if (refPreview && refPreview.src && refPreview.src.startsWith("data:image")) {
      const res = await fetch(refPreview.src);
      const blob = await res.blob();
      await fetch(`/api/session/${sid}/image`, {
        method: "POST",
        headers: { "Content-Type": blob.type || "image/jpeg" },
        body: blob,
      });
    }
    coreStore.setLastRelaySyncOk(true);
    if (dot) dot.textContent = "🟢";
    if (text) text.textContent = `已同步分鏡至中繼站 (${manifest.revision})`;
    return { ok: true, manifest };
  } catch (err) {
    coreStore.setLastRelaySyncOk(false);
    if (dot) dot.textContent = "🟠";
    if (text) {
      text.textContent =
        manifest.delivery_mode === "inline_payload"
          ? `中繼站未連線（已啟用指令內嵌分鏡 ${manifest.revision} 模式）`
          : `中繼站未連線（請點擊「💾 下載分鏡任務檔」交給 Agent · ${manifest.revision}）`;
    }
    console.warn("Notice: Manifest/Image auto-publish fallback to local/inline mode:", err);
    return { ok: false, manifest };
  }
}

export async function openColabNotebook(): Promise<void> {
  const sid = getOrCreateSessionId();
  const actionBtn = document.getElementById("openColabActionBtn") as HTMLButtonElement | null;
  if (actionBtn) {
    actionBtn.disabled = true;
    actionBtn.textContent = "⏳ 正在同步任務至雲端...";
  }

  await publishSessionManifestAndImage();

  if (actionBtn) {
    actionBtn.disabled = false;
    actionBtn.textContent = "🚀 在 Google Colab 開啟執行";
  }

  try {
    await navigator.clipboard.writeText(sid);
  } catch (_e) {
    const tmp = document.createElement("input");
    tmp.value = sid;
    document.body.appendChild(tmp);
    tmp.select();
    document.execCommand("copy");
    document.body.removeChild(tmp);
  }

  showToast(`✅ 已複製 Session ID: ${sid}！正在開啟 Colab，請貼上並點擊全部執行。`);
  startSessionListener(sid);

  const colabUrl = `https://colab.research.google.com/github/yshonlytest/h3-studio/blob/main/film-chain/notebooks/film_chain_runner.ipynb`;
  window.open(colabUrl, "_blank");
}

export async function cancelCurrentSessionGracefully(): Promise<void> {
  const sid = getOrCreateSessionId();
  if (!confirm("確定要中止後續段落生成嗎？\n\n系統將自動把前幾段已生成的影片進行無縫縫合並上傳，絕不浪費已完成的成果！")) {
    return;
  }
  try {
    await fetch(`/api/session/${sid}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "使用者手動要求中止" }),
    });
    showToast("⏹️ 已發送中止信號，正在等待完成部分無縫縫合...");
    const banner = document.getElementById("heartbeatWarningBanner");
    if (banner) banner.style.display = "none";
  } catch (e: any) {
    showToast(`⚠️ 發送中止信號失敗: ${e?.message || String(e)}`);
  }
}

export function startSessionListener(sessionId: string): void {
  const prevSse = coreStore.getState().sseSource;
  const prevPoll = coreStore.getState().sessionPollInterval;
  if (prevSse) {
    prevSse.close();
    coreStore.setSseSource(null);
  }
  if (prevPoll) {
    clearInterval(prevPoll);
    coreStore.setSessionPollInterval(null);
  }

  const dot = document.getElementById("sessionStatusDot");
  const text = document.getElementById("sessionStatusText");
  const idEl = document.getElementById("sessionStatusId");
  if (idEl) idEl.textContent = sessionId;

  const startPoll = () => {
    if (coreStore.getState().sessionPollInterval) return;
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/session/${sessionId}/status`);
        if (res.ok) {
          const data = await res.json();
          handleSessionUpdate(data);
        }
      } catch (err) {
        console.debug("Session poll failed:", err);
      }
    }, 2000);
    coreStore.setSessionPollInterval(poll);
  };

  try {
    const es = new EventSource(`/api/session/${sessionId}/events`);
    coreStore.setSseSource(es);
    es.onopen = () => {
      if (dot) dot.textContent = "🟢";
      if (text) text.textContent = "中繼通道已建立，監聽 Agent 訊號中";
    };
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleSessionUpdate(data);
      } catch (err) {
        console.debug("Malformed SSE event payload:", err);
      }
    };
    es.onerror = () => {
      const cur = coreStore.getState().sseSource;
      if (cur) {
        cur.close();
        coreStore.setSseSource(null);
      }
      startPoll();
    };
  } catch (_e) {
    startPoll();
  }
}

function markRenderCardsDone(renderCards: NodeListOf<Element>): void {
  renderCards.forEach((c) => {
    c.className = "pipeline-step-card stage-render stage-done";
    const timeEl = c.querySelector(".pipeline-step-time");
    if (timeEl) timeEl.textContent = "✅ 已完成";
  });
}

function applySessionStageProgress(
  data: Record<string, any>,
  card0: Element | null,
  cardMerge: Element | null,
  renderCards: NodeListOf<Element>
): void {
  if (data.stage === "stage0" || data.stage === "init") {
    if (card0) {
      card0.className = "pipeline-step-card stage-init active-running";
      const timeEl = card0.querySelector(".pipeline-step-time");
      if (timeEl) timeEl.textContent = `認證中 (${data.percent}%)`;
    }
    return;
  }

  if (data.stage === "merge") {
    if (card0) card0.className = "pipeline-step-card stage-init stage-done";
    markRenderCardsDone(renderCards);
    if (cardMerge) {
      cardMerge.className = "pipeline-step-card stage-merge active-running";
      const timeEl = cardMerge.querySelector(".pipeline-step-time");
      if (timeEl) timeEl.textContent = `拼接中 (${data.percent}%)`;
    }
    return;
  }

  if (typeof data.stage === "string" && data.stage.startsWith("stage")) {
    const partIdx = parseInt(data.stage.replace("stage", ""), 10);
    if (card0) {
      card0.className = "pipeline-step-card stage-init stage-done";
      const timeEl = card0.querySelector(".pipeline-step-time");
      if (timeEl) timeEl.textContent = "✅ 已認證";
    }
    renderCards.forEach((c, idx) => {
      const currentPart = idx + 1;
      const timeEl = c.querySelector(".pipeline-step-time");
      if (currentPart < partIdx) {
        c.className = "pipeline-step-card stage-render stage-done";
        if (timeEl) timeEl.textContent = "✅ 已完成";
      } else if (currentPart === partIdx) {
        c.className = "pipeline-step-card stage-render active-running";
        if (timeEl) timeEl.textContent = `推論中 (${data.percent}%)`;
      } else {
        c.className = "pipeline-step-card stage-render";
      }
    });
  }
}

export function handleSessionUpdate(data: any): void {
  if (!data || !data.stage) return;

  const currentPlan = storyboardStore.getState().currentPlan;
  const dot = document.getElementById("sessionStatusDot");
  const text = document.getElementById("sessionStatusText");
  if (dot) dot.textContent = data.status === "error" ? "🔴" : data.status === "completed" ? "✅" : "🟢";
  if (text) text.textContent = `${data.title || data.stage} (${data.percent || 0}%) - ${data.log || ""}`;

  const card0 = document.getElementById("stage-card-0");
  const cardMerge = document.getElementById("stage-card-merge");
  const renderCards = document.querySelectorAll("[id^='stage-card-part-']");

  applySessionStageProgress(data, card0, cardMerge, renderCards);

  if (data.status === "error") {
    const activeCard = document.querySelector(".pipeline-step-card.active-running") || card0;
    if (activeCard) {
      activeCard.className = "pipeline-step-card stage-error";
      const descEl = activeCard.querySelector(".pipeline-step-desc");
      if (descEl) descEl.innerHTML = `<span style="color:#f87171; font-weight:700;">❌ 發生錯誤：${escapeHtml(data.error_message || "執行中斷")}</span>`;
    }
  }

  if (data.status === "completed" || data.video_ready) {
    if (card0) card0.className = "pipeline-step-card stage-init stage-done";
    markRenderCardsDone(renderCards);
    if (cardMerge) {
      cardMerge.className = "pipeline-step-card stage-merge stage-done";
      const timeEl = cardMerge.querySelector(".pipeline-step-time");
      if (timeEl) timeEl.textContent = "✅ 拼接完成";
    }

    playCompletionChime();

    const videoUrl = data.video_url || `/api/session/${data.session_id}/video`;
    playVideoInStage(videoUrl, `🎉 AI Agent 雲端算力自動串流成果 (${currentPlan?.project_slug || "story"})`, true);

    const s4 = document.getElementById("step4Card");
    if (s4) s4.scrollIntoView({ behavior: "smooth" });
  }
}

export function updateColabPromptText(segs?: any[], totalSec?: number, slug?: string): string {
  const currentPlan = storyboardStore.getState().currentPlan;
  const activeProjectMode = coreStore.getState().activeProjectMode;
  const activeRoute = computeStore.getState().activeRoute;
  segs = segs || (currentPlan ? currentPlan.segments : []);
  const count = segs.length || 1;
  const isEdu = activeProjectMode === "edu" || currentPlan?.project_mode === "edu_explainer";
  let computedSec = totalSec;
  if (!computedSec) {
    let running = 0;
    segs.forEach((seg) => {
      if (typeof window.H3TimecodeHelper !== "undefined" && typeof window.H3TimecodeHelper.resolveSegmentTiming === "function") {
        running = window.H3TimecodeHelper.resolveSegmentTiming(seg, running, isEdu).endSec;
      } else {
        running += 5;
      }
    });
    computedSec = Math.round(running) || count * 5;
  }
  const sec = Math.round(computedSec);
  const s = slug || (currentPlan ? currentPlan.project_slug : "story_project");
  const baseSlug = String(s).replace(/_\d+(?:\.\d+)?s$/i, "");
  const manifestFilename =
    typeof window.H3TimecodeHelper !== "undefined" && typeof window.H3TimecodeHelper.buildColabManifestFilename === "function"
      ? window.H3TimecodeHelper.buildColabManifestFilename(s, sec)
      : `colab_manifest_${baseSlug}_${sec}s.json`;
  const sid = getOrCreateSessionId();
  const manifest = buildColabCompatibleManifest();
  const rev = (manifest && manifest.revision) || "rev_00000000";
  const deliveryMode = (manifest && manifest.delivery_mode) || "manifest_file";
  const inlineBlock =
    manifest && typeof window.H3TimecodeHelper !== "undefined" && typeof window.H3TimecodeHelper.formatInlinePayloadBlock === "function"
      ? window.H3TimecodeHelper.formatInlinePayloadBlock(manifest)
      : "";

  const promptText =
    window.H3Prompts && typeof window.H3Prompts.buildStage3RenderAgentPrompt === "function"
      ? window.H3Prompts.buildStage3RenderAgentPrompt({
          projectMode: isEdu ? "edu" : "creative",
          route: activeRoute || "colab",
          manifestFilename,
          baseSlug,
          totalSeconds: sec,
          segmentCount: segs.length,
          sessionId: sid,
          revision: rev,
          deliveryMode,
          inlineBlock,
          hasSegments: segs.length > 0,
        })
      : `python3 -m pipeline.h3_cli validate-manifest --manifest ${manifestFilename}`;

  const textarea1 = document.getElementById("colabPromptTextarea") as HTMLTextAreaElement | null;
  if (textarea1) textarea1.value = promptText;
  return promptText;
}

export function renderColabPipelineTracker(): void {
  if (isRenderingColabTracker) return;
  isRenderingColabTracker = true;
  try {
    _renderColabPipelineTrackerInner();
  } finally {
    isRenderingColabTracker = false;
  }
}

function _renderColabPipelineTrackerInner(): void {
  const container = document.getElementById("colabPipelineTracker");
  if (!container) return;
  const currentPlan = storyboardStore.getState().currentPlan;
  const activeProjectMode = coreStore.getState().activeProjectMode;
  const cards = document.querySelectorAll("#segmentsContainer .segment-card");
  const segs: Partial<StoryboardSegment>[] = [];
  cards.forEach((card, i) => {
    const framesSelect = card.querySelector<HTMLSelectElement>(".seg-frames-select");
    segs.push({
      title: card.querySelector<HTMLInputElement>(".seg-title-input")?.value.trim() || `Part ${i + 1}`,
      end_panel: parseInt(card.querySelector<HTMLSelectElement>(".seg-panel-select")?.value || "", 10) || 9,
      frames: framesSelect ? parseInt(framesSelect.value, 10) || 124 : currentPlan?.segments?.[i]?.frames || 124,
      prompt: card.querySelector<HTMLTextAreaElement>(".seg-prompt-input")?.value.trim() || "",
    });
  });
  const effectiveSegs = segs.length > 0 ? segs : currentPlan?.segments || [];
  const count = effectiveSegs.length;
  const slug = currentPlan?.project_slug || "story_project";
  const baseSlug = String(slug).replace(/_\d+(?:\.\d+)?s$/i, "");
  const handoffBadge = document.getElementById("step3HandoffStatusBadge");
  if (count === 0) {
    if (handoffBadge) handoffBadge.textContent = "📋 尚未建立分鏡（請先在步驟一／二產生分鏡）";
    container.innerHTML = `<div style="padding:10px 12px; color:#94a3b8; font-size:0.82rem;">⚠️ 尚未建立分鏡段落，完成步驟一／二分鏡確認後將顯示渲染管線預估。</div>`;
    updateColabPromptText([], 0, slug);
    return;
  }
  const isEdu = activeProjectMode === "edu" || currentPlan?.project_mode === "edu_explainer";
  const { ranges: timeRanges, totalSec } = computeSegmentTimeRanges(effectiveSegs, isEdu);
  const minTime = Math.round(count * 4.5);
  const maxTime = Math.round(count * 5.0);

  if (handoffBadge) {
    handoffBadge.textContent = `📋 待渲染分鏡：共 ${count} 段 · 總長 ${totalSec} 秒`;
  }

  let cardsHtml = `
        <div id="stage-card-0" class="pipeline-step-card stage-init">
          <div class="pipeline-step-num">
            <span>前置認證</span>
            <span>🔑</span>
          </div>
          <div class="pipeline-step-title">OAuth 授權與 GPU 啟動</div>
          <div class="pipeline-step-time">約 30 秒</div>
          <div class="pipeline-step-desc">colab login 驗證 Compute Units 餘額並指派 A100 運算單元</div>
        </div>
      `;

  effectiveSegs.forEach((seg: any, idx: number) => {
    const isFirst = idx === 0;
    const { startS, endS } = timeRanges[idx] || { startS: idx * 5, endS: (idx + 1) * 5 };
    const rawTitle = seg.title || `Part ${idx + 1}`;
    const cleanTitle = rawTitle.replace(/^Part\s*\d+\s*\(.*?\):\s*/i, "").trim() || rawTitle;
    const panelInfo = isEdu
      ? isFirst
        ? `講師首幀錨定 · 幻燈片對齊（864×480 音畫同步）`
        : `上一段潛空間延續 · 講義圖表無損對齊`
      : isFirst
        ? `首段錨定九宮格 Panel ${Number(seg.end_panel) || 3}（124 幀 / 1376×768 音畫同步）`
        : `自動截取 Part ${idx} 最後一幀作為本段首幀 · 錨定 Panel ${Number(seg.end_panel) || 9}`;

    cardsHtml += `
          <div id="stage-card-part-${idx + 1}" class="pipeline-step-card stage-render">
            <div class="pipeline-step-num">
              <span>段落 ${idx + 1}/${count}</span>
              <span>🎬</span>
            </div>
            <div class="pipeline-step-title" style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
              <span class="part-pill">Part ${idx + 1}</span>
              <span class="time-pill">⏱️ ${startS} - ${endS}s</span>
            </div>
            <div class="pipeline-step-time">4~5 分鐘 (A100)</div>
            <div class="pipeline-step-desc">
              <strong style="color:#e0f2fe;">${escapeHtml(cleanTitle)}</strong><br>
              <span style="color:#94a3b8; font-size:0.71rem;">${panelInfo}</span>
            </div>
          </div>
        `;
  });

  cardsHtml += `
        <div id="stage-card-merge" class="pipeline-step-card stage-merge">
          <div class="pipeline-step-num">
            <span>終端縫合</span>
            <span>⚡</span>
          </div>
          <div class="pipeline-step-title">FFmpeg 端側無縫拼接</div>
          <div class="pipeline-step-time">約 1 秒 (即時完成)</div>
          <div class="pipeline-step-desc">自動消除銜接處首格重複幀，無損 concat 輸出 <strong>${totalSec} 秒</strong> 完整長影片</div>
        </div>
      `;

  container.innerHTML = `
        <div class="pipeline-tracker-header">
          <h4 style="font-size:0.92rem; color:#38bdf8; margin:0; display:flex; align-items:center; gap:8px;">
            <span>⏱️ 雲端渲染與拼接管線進度預估 (共 ${count} 段 · 總長 ${totalSec} 秒)</span>
            <span class="info-tip" role="button" tabindex="0" aria-label="查看實測效能基準說明">ⓘ
              <span class="tooltip-content">
                <strong>💡 實測效能基準</strong><br>
                每段 5 秒 (1376×768) 影片在 Colab A100 上實測約需 4 分 40 秒。Agent 會自動接力完成 ${count} 段渲染、尾幀傳遞與 ffmpeg 拼接。
              </span>
            </span>
          </h4>
          <span class="badge ok" style="border-color:#38bdf8; color:#7dd3fc; background:rgba(56,189,248,0.18);">
            預估總耗時：約 ${minTime} ~ ${maxTime} 分鐘
          </span>
        </div>
        <div class="pipeline-tracker-grid">
          ${cardsHtml}
        </div>
      `;

  const hintEl = document.getElementById("colabOutputFilenameHint");
  if (hintEl) hintEl.textContent = `${baseSlug}_${totalSec}s_seamless_merged.mp4`;

  updateColabPromptText(effectiveSegs, totalSec, slug);

  const sid = getOrCreateSessionId();
  startSessionListener(sid);
}

export function copyColabPrompt(): void {
  syncSegmentsFromDOM();
  renderColabPipelineTracker();
  publishSessionManifestAndImage();
  const textarea = document.getElementById("colabPromptTextarea") as HTMLTextAreaElement | null;
  if (!textarea) return;
  const textToCopy = textarea.value;

  function onCopySuccess(): void {
    const btn = document.getElementById("copyColabPromptBtn");
    if (!btn) return;
    const originalText = btn.textContent;
    btn.textContent = "✅ 已複製 Colab 指令！";
    btn.style.borderColor = "#10b981";
    btn.style.color = "#a7f3d0";
    const m = buildColabCompatibleManifest();
    const lastRelaySyncOk = coreStore.getState().lastRelaySyncOk;
    if (m && m.delivery_mode === "inline_payload") {
      showToast("📋 已複製 Agent 指令（已內嵌 " + m.revision + " 分鏡 Payload，可直接貼給 Agent）！");
    } else if (!lastRelaySyncOk) {
      showToast("📋 已複製指令（" + (m ? m.revision : "") + "）！中繼站未連線，請一併點擊「💾 下載分鏡任務檔 (.json)」。");
    } else {
      showToast("📋 已複製 Agent 終端指令（已同步 " + (m ? m.revision : "") + " 至中繼站）！");
    }
    setTimeout(() => {
      btn.textContent = originalText;
      btn.style.borderColor = "#38bdf8";
      btn.style.color = "#7dd3fc";
    }, 2500);
  }

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(textToCopy).then(onCopySuccess).catch(() => {
      fallbackCopyText(textarea, onCopySuccess);
    });
  } else {
    fallbackCopyText(textarea, onCopySuccess);
  }
}

export function exportColabManifest(): null | void {
  const manifest = buildColabCompatibleManifest();
  if (!manifest || !Array.isArray(manifest.segments) || manifest.segments.length === 0) {
    showToast("⚠️ 請先在步驟一／二建立並確認分鏡段落後，再下載分鏡任務檔！");
    return null;
  }
  const slug = manifest.project || "film_chain_story";
  const totalSec = manifest.total_seconds || 5;
  const filename =
    typeof window.H3TimecodeHelper !== "undefined" && typeof window.H3TimecodeHelper.buildColabManifestFilename === "function"
      ? window.H3TimecodeHelper.buildColabManifestFilename(slug, totalSec)
      : `colab_manifest_${String(slug).replace(/_\d+(?:\.\d+)?s$/i, "")}_${totalSec}s.json`;

  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(manifest, null, 2));
  const a = document.createElement("a");
  a.href = dataStr;
  a.download = filename;
  a.click();
  showToast(`💾 已下載分鏡任務檔 ${filename}！`);
}
