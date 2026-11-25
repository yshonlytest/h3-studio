import type { StoryboardPlan, StoryboardSegment } from "../types/studio.ts";
import { formatDiagnosticError } from "../utils/errors.ts";
import { SPEED_CONFIGS } from "../data/templates.ts";
import { computeStore } from "../stores/computeStore.ts";
import { coreStore } from "../stores/coreStore.ts";
import { storyboardStore } from "../stores/storyboardStore.ts";
import {
  copyTextToClipboard,
  escapeHtml,
  getPrefs,
  showToast,
  updateLocalRenderEstimateUI,
  updateStep3UI,
} from "./uiShell.ts";
import { buildColabCompatibleManifest, publishSessionManifestAndImage, renderColabPipelineTracker } from "./sessionColab.ts";
import {
  buildAgentPlanTaskPack,
  buildDirectorSystemPrompt,
  dispatchPlanByProvider,
} from "./director.ts";
import { onShotDialogueInput } from "./eduStudio.ts";
import { applyPhoneticSubstitutions, renderPhoneticHintBadge } from "./phoneticsLexicon.ts";
import { lintH3PromptText } from "./dispatchLocalComfy.ts";
import { syncDialogueItemsFromPlan } from "./audioSubtitles.ts";
import { scheduleAutoSave } from "./workspaceManager.ts";

interface PromptBackupCard extends HTMLElement {
  _lastPromptBackup?: string;
}

interface TrackCanvasElement extends HTMLCanvasElement {
  _track?: {
    start: { x: number; y: number };
    end: { x: number; y: number };
    subject: { x: number; y: number };
  };
}

export function onChainParadigmChange(fromUser = false): void {
  const paradigmSelect = document.getElementById("chainParadigmSelect") as HTMLSelectElement | null;
  const paradigm = paradigmSelect ? paradigmSelect.value : "latent_chain";
  const gridContainer = document.getElementById("gridPreviewContainer");
  const barContainer = document.getElementById("slicedPanelsContainer");
  const planBtn = document.getElementById("planBtn");
  const step2Title = document.getElementById("step2HeaderTitleText");
  const imgSelect = document.getElementById("imageProviderSelect") as HTMLSelectElement | null;
  const targetMode = paradigm === "latent_chain" ? "motion_context" : "first_frame";
  const gridImageDataUrl = storyboardStore.getState().gridImageDataUrl;

  const modeSelects = Array.from(document.querySelectorAll<HTMLSelectElement>("#segmentsContainer .seg-chain-mode-select"));
  const customizedSelects = modeSelects.filter((sel) => sel.dataset.userModified === "true" && sel.value !== targetMode);

  let shouldOverwriteSegments = true;
  if (fromUser && customizedSelects.length > 0) {
    const modeLabel = paradigm === "latent_chain" ? "🔗 潛空間（一鏡到底）" : "🖼️ 九宮格（自訂分鏡）";
    shouldOverwriteSegments = window.confirm(
      `步驟二目前有 ${customizedSelects.length} 段分鏡已手動調整過接力方式。\n\n是否要將所有分段統一重設為「${modeLabel}」？\n（點擊「取消」將保留各段目前的自訂接力設定）`
    );
  }

  if (paradigm === "latent_chain") {
    if (gridContainer) gridContainer.style.display = "none";
    if (barContainer) barContainer.style.display = "none";
    if (planBtn) planBtn.textContent = "✨ 生成分鏡腳本（潛空間一鏡到底）";
    if (step2Title) step2Title.textContent = "步驟二：分鏡腳本與運鏡微調（潛空間一鏡到底）";
    if (imgSelect) {
      imgSelect.disabled = true;
      imgSelect.title = "潛空間一鏡到底不使用九宮格圖，無需選擇生圖模型";
    }
    const imgLabelGray = document.getElementById("imageProviderLabel");
    if (imgLabelGray) imgLabelGray.style.opacity = "0.45";
    if (shouldOverwriteSegments) {
      modeSelects.forEach((sel) => {
        sel.value = "motion_context";
        delete sel.dataset.userModified;
      });
    }
  } else {
    if (gridContainer && gridImageDataUrl) {
      gridContainer.style.display = "block";
    }
    if (barContainer) barContainer.style.display = "flex";
    if (planBtn) planBtn.textContent = "✨ 生成分鏡腳本與九宮格圖";
    if (step2Title) step2Title.textContent = "步驟二：九宮格與分鏡腳本微調";
    if (imgSelect) {
      imgSelect.disabled = false;
      imgSelect.title = "";
    }
    const imgLabelBright = document.getElementById("imageProviderLabel");
    if (imgLabelBright) imgLabelBright.style.opacity = "1";
    if (imgSelect && !imgSelect.value) imgSelect.value = "agent-image";
    if (shouldOverwriteSegments) {
      modeSelects.forEach((sel) => {
        sel.value = "first_frame";
        delete sel.dataset.userModified;
      });
    }
  }
  refreshAllSegmentCardModeUI();
  syncSegmentsFromDOM();
}

export function batchApplyChainMode(targetMode: string): void {
  const modeSelects = Array.from(document.querySelectorAll<HTMLSelectElement>("#segmentsContainer .seg-chain-mode-select"));
  const customizedCount = modeSelects.filter((sel) => sel.value !== targetMode).length;
  if (customizedCount > 0) {
    const label = targetMode === "motion_context" ? "🔗 潛空間（一鏡到底）" : "🖼️ 九宮格（關鍵幀）";
    if (!window.confirm(`確定要將步驟二共 ${customizedCount} 個分段統一套用為「${label}」嗎？`)) {
      return;
    }
  }
  const paradigmSelect = document.getElementById("chainParadigmSelect") as HTMLSelectElement | null;
  if (paradigmSelect) {
    paradigmSelect.value = targetMode === "motion_context" ? "latent_chain" : "grid_keyframes";
  }
  modeSelects.forEach((sel) => {
    sel.value = targetMode;
    delete sel.dataset.userModified;
  });
  onChainParadigmChange(false);
  showToast(`✅ 已批次套用「${targetMode === "motion_context" ? "🔗 潛空間（一鏡到底）" : "🖼️ 九宮格（關鍵幀）"}」`);
}

export function onSegChainModeChange(selectEl: HTMLSelectElement): void {
  selectEl.dataset.userModified = "true";
  refreshAllSegmentCardModeUI();
  syncSegmentsFromDOM();
}

export function refreshAllSegmentCardModeUI(): void {
  const paradigm = (document.getElementById("chainParadigmSelect") as HTMLSelectElement | null)?.value || "latent_chain";
  const activeProjectMode = coreStore.getState().activeProjectMode;
  const cards = document.querySelectorAll("#segmentsContainer .segment-card");
  cards.forEach((card, idx) => {
    const modeSelect = card.querySelector<HTMLSelectElement>(".seg-chain-mode-select");
    const mode = idx === 0 ? (paradigm === "latent_chain" ? "latent_anchor" : "first_frame") : modeSelect ? modeSelect.value : "motion_context";
    const pickerGroup = card.querySelector<HTMLElement>(".seg-panel-picker-group");
    const latentBadge = card.querySelector<HTMLElement>(".seg-latent-badge");
    if (mode === "motion_context" || mode === "latent_anchor") {
      if (pickerGroup) pickerGroup.style.display = "none";
      if (latentBadge) {
        latentBadge.style.display = "inline-flex";
        latentBadge.textContent = idx === 0 ? "🖼️ 首幀：主角參考圖錨定" : `🔗 承接 Part ${idx} 潛空間尾幀`;
      }
    } else {
      if (pickerGroup) pickerGroup.style.display = activeProjectMode === "edu" ? "none" : "inline-flex";
      if (latentBadge) latentBadge.style.display = "none";
    }
    const isEdu = activeProjectMode === "edu";
    card.querySelectorAll<HTMLElement>(".seg-edu-strip").forEach((el) => {
      el.style.display = isEdu ? "flex" : "none";
    });
  });
  renderChainTimelineBar();
}

export function renderChainTimelineBar(): void {
  const bar = document.getElementById("chainTimelineBar");
  if (!bar) return;
  const cards = document.querySelectorAll("#segmentsContainer .segment-card");
  if (!cards.length) {
    bar.innerHTML = `<span style="font-size:0.8rem; color:#64748b;">尚無分鏡段落</span>`;
    return;
  }
  const isEdu = coreStore.getState().activeProjectMode === "edu";
  const paradigm = (document.getElementById("chainParadigmSelect") as HTMLSelectElement | null)?.value || "latent_chain";
  const partsHtml: string[] = [];
  let runningSec = 0;

  cards.forEach((card, idx) => {
    if (isEdu) {
      const framesSelect = card.querySelector<HTMLSelectElement>(".seg-frames-select");
      const frames = framesSelect ? parseInt(framesSelect.value, 10) || 124 : 124;
      const sec = Math.floor((frames / 24) * 10) / 10;
      const startSec = Math.round(runningSec * 10) / 10;
      runningSec += sec;
      const endSec = Math.round(runningSec * 10) / 10;

      const shotTypeSelect = card.querySelector<HTMLSelectElement>(".seg-shot-type-select");
      const shotType = shotTypeSelect ? shotTypeSelect.value : "presenter_chart";
      let typeBadge = "📊 圖表";
      if (shotType === "presenter_focus") typeBadge = "🎤 講者";
      else if (shotType === "pure_b_roll") typeBadge = "🌄 空鏡";

      if (idx > 0) {
        partsHtml.push(`<span style="color:#a855f7; font-size:0.78rem; font-weight:700; white-space:nowrap;">──🎓 連貫教學──▶</span>`);
      }
      partsHtml.push(`
            <button type="button" onclick="document.querySelectorAll('#segmentsContainer .segment-card')[${idx}]?.scrollIntoView({behavior:'smooth', block:'center'})" style="display:inline-flex; align-items:center; gap:6px; padding:6px 11px; border-radius:8px; border:1px solid #7c3aed; background:rgba(124,58,237,0.18); color:#f3e8ff; font-size:0.8rem; cursor:pointer; white-space:nowrap;">
              <strong>Part ${idx + 1}</strong>
              <span style="color:#d8b4fe; font-size:0.75rem;">(${startSec}-${endSec}s)</span>
              <span style="color:#c084fc; font-weight:600;">${typeBadge} (${frames}f)</span>
            </button>
          `);
    } else {
      const modeSelect = card.querySelector<HTMLSelectElement>(".seg-chain-mode-select");
      const mode = idx === 0 ? "first_frame" : modeSelect ? modeSelect.value : "motion_context";
      const panelVal = card.querySelector<HTMLSelectElement>(".seg-panel-select")?.value || String(idx + 1);
      const isLatent = idx > 0 && mode === "motion_context";
      if (idx > 0) {
        partsHtml.push(
          isLatent
            ? `<span style="color:#38bdf8; font-size:0.78rem; font-weight:700; white-space:nowrap;">──🔗 潛空間接力──▶</span>`
            : `<span style="color:#f59e0b; font-size:0.78rem; font-weight:700; white-space:nowrap;">──🖼️ 關鍵幀切換──▶</span>`
        );
      }
      const safeIdx = Math.trunc(idx);
      const safePanelVal = escapeHtml(panelVal);
      const badgeText = idx === 0 ? (paradigm === "latent_chain" ? "🖼️ 首幀錨定" : `🖼️ Panel ${safePanelVal}`) : isLatent ? "🔒 一鏡到底" : `🖼️ Panel ${safePanelVal}`;
      const borderColor = isLatent ? "#0284c7" : "#475569";
      const bg = isLatent ? "rgba(2,132,199,0.16)" : "rgba(30,41,59,0.7)";
      partsHtml.push(`
            <button type="button" onclick="document.querySelectorAll('#segmentsContainer .segment-card')[${safeIdx}]?.scrollIntoView({behavior:'smooth', block:'center'})" style="display:inline-flex; align-items:center; gap:6px; padding:6px 11px; border-radius:8px; border:1px solid ${borderColor}; background:${bg}; color:#e2e8f0; font-size:0.8rem; cursor:pointer; white-space:nowrap;">
              <strong>Part ${safeIdx + 1}</strong>
              <span style="color:#94a3b8; font-size:0.75rem;">(${safeIdx * 5}-${(safeIdx + 1) * 5}s)</span>
              <span style="color:${isLatent ? "#7dd3fc" : "#fcd34d"}; font-weight:600;">${badgeText}</span>
            </button>
          `);
    }
  });
  const prefixText = isEdu ? "🧭 教學長片時間軸：" : "🧭 接力時間軸：";
  bar.innerHTML = `<span style="font-size:0.8rem; color:#94a3b8; font-weight:600; white-space:nowrap; margin-right:4px;">${prefixText}</span>` + partsHtml.join("");
}

export function renderPlanUI(plan: StoryboardPlan): void {
  storyboardStore.setPlan(plan);

  const container = document.getElementById("segmentsContainer")!;
  container.innerHTML = "";
  (plan.segments || []).forEach((seg, idx) => {
    appendSegmentCardDOM(seg, idx);
  });
  updateDurationBadge();
  syncDialogueItemsFromPlan();
  refreshAllSegmentCardModeUI();

  const gridPrompt = String(plan.grid_image_prompt || "").trim();
  const hintEl = document.getElementById("gridAgentHint");
  const rowEl = document.getElementById("gridAgentPromptRow");
  const textEl = document.getElementById("gridAgentPromptText") as HTMLTextAreaElement | null;
  if (hintEl && rowEl && textEl) {
    hintEl.style.display = gridPrompt ? "block" : "none";
    rowEl.style.display = gridPrompt ? "flex" : "none";
    textEl.value = gridPrompt || "";
  }
}

export function copyGridImagePrompt(): void {
  const textEl = document.getElementById("gridAgentPromptText") as HTMLTextAreaElement | null;
  if (!textEl || !textEl.value.trim()) {
    showToast("⚠️ 目前分鏡沒有九宮格生圖提示（grid_image_prompt）");
    return;
  }
  copyTextToClipboard(textEl.value.trim(), "📋 已複製九宮格生圖提示！貼給你的 Agent 產 3×3 PNG（不含文字浮水印）再於此上傳");
}

export function renderMiniGridHTML(selectedPanel: number | string): string {
  const safePanel = Number(selectedPanel) || 9;
  let cells = "";
  for (let p = 1; p <= 9; p++) {
    const isActive = safePanel === p ? "active" : "";
    cells += `<div class="mini-grid-cell ${isActive}"></div>`;
  }
  return `<div class="mini-grid-indicator" title="目前鎖定 Panel ${escapeHtml(String(selectedPanel))}（1~9：由左至右、由上至下）">${cells}</div>`;
}

export function onPanelSelectChange(selectEl: HTMLSelectElement): void {
  const panel = parseInt(selectEl.value, 10);
  const container = selectEl.parentElement?.querySelector<HTMLElement>(".mini-grid-indicator");
  if (container) {
    container.querySelectorAll(".mini-grid-cell").forEach((cell, i) => {
      cell.classList.toggle("active", i + 1 === panel);
    });
    container.title = `目前鎖定 Panel ${panel}（1~9：由左至右、由上至下）`;
  }
  syncSegmentsFromDOM();
}

interface SegmentCardContext {
  safeIdx: number;
  safeEndPanel: number;
  startSec: number;
  endSec: number;
  parsedIr: Record<string, string>;
  isLatentSeg: boolean;
  initialDialogue: string;
  activeProjectMode: string;
  isEdu: boolean;
}

function resolveSegmentCardContext(seg: Partial<StoryboardSegment>, idx: number): SegmentCardContext {
  const safeIdx = Math.trunc(idx);
  const safeEndPanel = Number(seg.end_panel) || 9;
  const parsedIr: Record<string, string> =
    seg.context_ir && typeof seg.context_ir === "object"
      ? (seg.context_ir as Record<string, string>)
      : typeof window.H3PromptBuilder !== "undefined" && window.H3PromptBuilder.parseContextIRFromPrompt
        ? window.H3PromptBuilder.parseContextIRFromPrompt(seg.prompt || "")
        : { scene: "", camera: "", action: "", look: "", audio: "" };
  const paradigm = (document.getElementById("chainParadigmSelect") as HTMLSelectElement | null)?.value || "latent_chain";
  const isLatentSeg = safeIdx === 0 ? paradigm === "latent_chain" : !seg.chain_mode || seg.chain_mode === "motion_context";
  const initialDialogue = seg.dialogue || (seg.prompt && (seg.prompt.match(/<d>(?:\[\w+\])?\s*(.*?)<\/d>/) || [])[1]) || "";
  const activeProjectMode = coreStore.getState().activeProjectMode;
  return {
    safeIdx,
    safeEndPanel,
    startSec: safeIdx * 5,
    endSec: (safeIdx + 1) * 5,
    parsedIr,
    isLatentSeg,
    initialDialogue,
    activeProjectMode,
    isEdu: activeProjectMode === "edu",
  };
}

function buildSegmentChainControlHtml(seg: Partial<StoryboardSegment>, ctx: SegmentCardContext): string {
  if (ctx.isEdu) {
    return `<span class="seg-edu-mode-badge" style="font-size:0.8rem; color:#d8b4fe; background:rgba(168,85,247,0.18); border:1px solid rgba(168,85,247,0.35); padding:4px 9px; border-radius:6px;">🎓 教學連貫分鏡</span>`;
  }
  if (ctx.safeIdx === 0) {
    return `<span class="seg-latent-badge" style="display:${ctx.isLatentSeg ? "inline-flex" : "none"}; font-size:0.82rem; color:#7dd3fc; background:rgba(2,132,199,0.15); border:1px solid rgba(56,189,248,0.35); padding:4px 10px; border-radius:6px;">🖼️ 首幀：主角參考圖錨定</span>`;
  }
  return `<div style="display:inline-flex; align-items:center; gap:6px;">
               <span style="font-size:0.82rem; color:var(--muted);">接力：</span>
               <select class="seg-chain-mode-select" onchange="onSegChainModeChange(this)" style="padding:5px 8px; font-size:0.82rem; min-height:36px;">
                 <option value="motion_context" ${!seg.chain_mode || seg.chain_mode === "motion_context" ? "selected" : ""}>🔗 潛空間（一鏡到底）</option>
                 <option value="first_frame" ${seg.chain_mode === "first_frame" ? "selected" : ""}>🖼️ 九宮格（關鍵幀）</option>
               </select>
               <span class="seg-latent-badge" style="display:${ctx.isLatentSeg ? "inline-flex" : "none"}; font-size:0.8rem; color:#7dd3fc; background:rgba(2,132,199,0.15); border:1px solid rgba(56,189,248,0.3); padding:4px 9px; border-radius:6px;">🔗 承接 Part ${ctx.safeIdx} 潛空間尾幀</span>
             </div>`;
}

export function appendSegmentCardDOM(seg: Partial<StoryboardSegment>, idx: number): void {
  const ctx = resolveSegmentCardContext(seg, idx);
  const { safeIdx, safeEndPanel, startSec, endSec, parsedIr, isLatentSeg, initialDialogue, activeProjectMode } = ctx;
  const container = document.getElementById("segmentsContainer")!;
  const div = document.createElement("div");
  div.className = "segment-card";
  const chainSelectHTML = buildSegmentChainControlHtml(seg, ctx);
  div.innerHTML = `
        <div class="segment-card-header">
          <div class="seg-header-main">
            <span class="part-pill">Part ${idx + 1}</span>
            <span class="time-pill">⏱️ ${startSec} - ${endSec}s</span>
            <input type="text" class="seg-title-input" value="${escapeHtml(seg.title || `Part ${idx + 1} (${startSec}-${endSec}s)`)}" placeholder="分鏡情節說明..." />
          </div>
          <div class="seg-header-controls">
            ${chainSelectHTML}
            <div class="seg-panel-picker-group" style="display:${isLatentSeg || activeProjectMode === "edu" ? "none" : "inline-flex"}; align-items:center; gap:6px;">
              <span style="font-size:0.82rem; color:var(--muted);">→ 目標尾幀：</span>
              ${renderMiniGridHTML(safeEndPanel)}
              <select class="seg-panel-select" onchange="onPanelSelectChange(this)" style="width:100px; padding:5px 8px; font-size:0.82rem; min-height:36px;">
                ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<option value="${n}" ${safeEndPanel === n ? "selected" : ""}>Panel ${n}</option>`).join("")}
              </select>
            </div>
            <button type="button" onclick="removeSegmentCard(this)" style="padding:5px 10px; font-size:0.82rem; min-height:36px; color:var(--danger);">🗑️ 刪除</button>
          </div>
        </div>

        <div class="seg-edu-strip" style="display:${activeProjectMode === "edu" ? "flex" : "none"}; flex-wrap:wrap; align-items:center; gap:8px; margin:6px 0 8px 0; padding:8px 10px; background:rgba(168,85,247,0.08); border:1px solid rgba(168,85,247,0.25); border-radius:6px;">
          <span style="font-size:0.8rem; color:#d8b4fe; font-weight:600;">🎓 鏡頭模式：</span>
          <select class="seg-shot-type-select" onchange="onShotTypeChange(this)" style="padding:4px 8px; font-size:0.8rem; min-height:32px; background:#0f0920; color:#d8b4fe; border:1px solid #a855f7; border-radius:4px;">
            <option value="presenter_focus" ${seg.shot_type === "presenter_focus" ? "selected" : ""}>🎤 講者主鏡 (Presenter Focus)</option>
            <option value="presenter_chart" ${!seg.shot_type || seg.shot_type === "presenter_chart" ? "selected" : ""}>📊 圖表+講者側影 (防漂移錨點 · 推薦)</option>
            <option value="pure_b_roll" ${seg.shot_type === "pure_b_roll" ? "selected" : ""}>🌄 純空鏡 (強化聲學旁白)</option>
          </select>

          <span class="seg-pacing-badge badge ok" style="font-size:0.76rem; border-color:#a855f7; color:#d8b4fe; background:rgba(168,85,247,0.2);">字數: 0</span>

          <select class="seg-frames-select" onchange="onShotFramesChange(this)" style="padding:4px 8px; font-size:0.8rem; min-height:32px; background:#0f0920; color:#d8b4fe; border:1px solid #a855f7; border-radius:4px;">
            <option value="93" ${Number(seg.frames) === 93 ? "selected" : ""}>93f (3.8s)</option>
            <option value="124" ${!seg.frames || Number(seg.frames) === 124 ? "selected" : ""}>124f (5.1s)</option>
            <option value="155" ${Number(seg.frames) === 155 ? "selected" : ""}>155f (6.4s)</option>
            <option value="186" ${Number(seg.frames) === 186 ? "selected" : ""}>186f (7.7s)</option>
          </select>

          <button type="button" class="seg-split-btn btn" onclick="splitSegmentCardInTwo(this)" style="display:none; padding:4px 10px; font-size:0.76rem; min-height:30px; background:rgba(239,68,68,0.2); border-color:#ef4444; color:#fca5a5;">拆分為兩鏡</button>
          <button type="button" class="btn" onclick="rerollSingleShot(${idx + 1})" style="padding:4px 10px; font-size:0.76rem; min-height:30px; background:rgba(168,85,247,0.18); border-color:#a855f7; color:#d8b4fe;">重算此鏡</button>
        </div>

        <details open class="seg-dialogue-details" style="margin:6px 0 8px 0; background:rgba(15,23,42,0.65); border:1px solid #1e3a5f; border-radius:6px; padding:6px 10px;">
          <summary style="cursor:pointer; color:#7dd3fc; font-weight:600; font-size:0.8rem; display:flex; align-items:center; justify-content:space-between; user-select:none;">
            <span>🎙️ 台詞、音軌與發音校正</span>
            <span style="font-size:0.74rem; color:#94a3b8;">收合／展開 ▾</span>
          </summary>
          <div class="seg-audio-controls-row" style="display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-top:8px;">
            <div style="flex:1; min-width:220px; display:flex; align-items:center; gap:6px;">
              <span style="font-size:0.8rem; color:#38bdf8; font-weight:600; white-space:nowrap;">台詞：</span>
              <input type="text" class="seg-dialogue-input" value="${escapeHtml(initialDialogue)}" oninput="onShotDialogueInput(this)" placeholder="輸入台詞（如：期末作業截止只剩幾小時、步驟一打上一句想像...）" style="flex:1; padding:4px 8px; font-size:0.82rem; min-height:32px; background:#0f0920; color:#f1f5f9; border:1px solid #475569; border-radius:4px;" />
            </div>
            <button type="button" class="btn" onclick="rerollShotAudio(${idx + 1})" style="padding:4px 10px; font-size:0.76rem; min-height:30px; background:rgba(56,189,248,0.18); border-color:#38bdf8; color:#7dd3fc;" title="調用 H3 代理畫布重抽 32kHz 音訊，保留原片聲紋與背景音樂">
              重抽音軌
            </button>
            <button type="button" class="btn" onclick="toggleShotPhoneticsDrawer(this, ${idx + 1})" style="padding:4px 10px; font-size:0.76rem; min-height:30px; background:rgba(245,158,11,0.18); border-color:#f59e0b; color:#fde68a;" title="展開查看破音字偵測、字幕文字 vs 口播讀音">
              發音校正 ▾
            </button>
            <span class="seg-phonetic-badge" style="font-size:0.74rem; color:#94a3b8;">${renderPhoneticHintBadge(initialDialogue)}</span>
          </div>
        </details>

        <div class="seg-phonetics-drawer" style="display:none; margin:4px 0 8px 0; padding:10px; background:#070d1a; border:1px solid #334155; border-radius:6px;">
          <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:10px;">
            <div>
              <label style="font-size:0.76rem; color:#94a3b8;">📝 字幕顯示文字 (display_dialogue)</label>
              <input type="text" class="seg-display-dialogue-input" value="${escapeHtml(seg.display_dialogue || initialDialogue)}" oninput="onDisplayDialogueChange(this, ${idx})" style="width:100%; padding:5px 8px; font-size:0.8rem; background:#0b1329; border:1px solid #3b82f6; border-radius:4px; color:#fff;" placeholder="觀眾在畫面上看到的字幕文字" />
            </div>
            <div>
              <label style="font-size:0.76rem; color:#fde68a;">🗣️ 唯一發音口播讀音 (spoken_dialogue)</label>
              <input type="text" class="seg-spoken-dialogue-input" value="${escapeHtml(seg.spoken_dialogue || initialDialogue)}" oninput="onSpokenDialogueChange(this, ${idx})" style="width:100%; padding:5px 8px; font-size:0.8rem; background:#0b1329; border:1px solid #f59e0b; border-radius:4px; color:#fff;" placeholder="模型實際朗讀的唯一讀音同音字（防破音與方言）" />
            </div>
          </div>
          <div style="font-size:0.72rem; color:#94a3b8; margin-top:6px;">
            💡 字幕文字與發音分開設定，可精準校正破音字。
          </div>
        </div>

        <details style="margin:6px 0 8px 0; font-size:0.82rem; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:6px; padding:8px 10px;">
          <summary style="cursor:pointer; color:#93c5fd; font-weight:600; padding:4px 0;">🧭 5D 分鏡參數（修改欄位自動同步至下方對應段落）</summary>
          <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap:8px; margin-top:8px;">
            <div><label style="color:var(--muted); font-size:0.78rem;">場景 (Scene)</label><input type="text" class="ir-scene" oninput="onSingleIRFieldInput(this, 'scene')" value="${escapeHtml(parsedIr.scene || "")}" placeholder="例: Okinawa street at dusk" style="width:100%; padding:6px 8px; font-size:0.82rem;" /></div>
            <div><label style="color:var(--muted); font-size:0.78rem;">運鏡 (Camera)</label><input type="text" class="ir-camera" oninput="onSingleIRFieldInput(this, 'camera')" value="${escapeHtml(parsedIr.camera || "")}" placeholder="例: Low angle tracking" style="width:100%; padding:6px 8px; font-size:0.82rem;" /></div>
            <div><label style="color:var(--muted); font-size:0.78rem;">動作 (Action)</label><input type="text" class="ir-action" oninput="onSingleIRFieldInput(this, 'action')" value="${escapeHtml(parsedIr.action || "")}" placeholder="例: 0-5s: smiles and waves" style="width:100%; padding:6px 8px; font-size:0.82rem;" /></div>
            <div><label style="color:var(--muted); font-size:0.78rem;">影調 (Look)</label><input type="text" class="ir-look" oninput="onSingleIRFieldInput(this, 'look')" value="${escapeHtml(parsedIr.look || "")}" placeholder="例: Warm golden hour" style="width:100%; padding:6px 8px; font-size:0.82rem;" /></div>
            <div><label style="color:var(--muted); font-size:0.78rem;">音訊/對白 (Audio)</label><input type="text" class="ir-audio" oninput="onSingleIRFieldInput(this, 'audio')" value="${escapeHtml(parsedIr.audio || "")}" placeholder="例: Breeze, <d>[Chinese] 你好</d>" style="width:100%; padding:6px 8px; font-size:0.82rem;" /></div>
          </div>
          <div style="display:flex; align-items:center; gap:8px; margin-top:8px; flex-wrap:wrap;">
            <button type="button" onclick="applyContextIRToCard(this, ${idx})" style="padding:6px 12px; font-size:0.8rem; min-height:36px; background:#2563eb; color:#fff; border-radius:6px; border:none; cursor:pointer;">✨ 完整重組 Prompt</button>
            <button type="button" class="ir-undo-btn" onclick="undoPromptOverwrite(this)" style="display:none; padding:6px 12px; font-size:0.8rem; min-height:36px; background:#334155; color:#e2e8f0; border-radius:6px; border:1px solid #64748b; cursor:pointer;">↩️ 復原上一版 Prompt</button>
            <span style="font-size:0.76rem; color:var(--muted);">💡 修改上方任一欄會即時局部更新對應標籤，不會洗掉其他手改內容</span>
          </div>
        </details>
        <details class="staging-board-details" ontoggle="onStagingDetailsToggle(this)" style="margin:4px 0 8px 0; font-size:0.82rem; background:rgba(30,41,59,0.25); border:1px solid rgba(56,189,248,0.2); border-radius:6px; padding:8px 10px;">
          <summary style="cursor:pointer; color:#38bdf8; font-weight:600; padding:4px 0;">🎬 2D 運鏡軌跡板（拖曳機位）</summary>
          <div style="display:flex; flex-wrap:wrap; align-items:center; gap:12px; margin-top:8px;">
            <canvas class="staging-canvas" width="280" height="160" style="background:#0f172a; border:1px solid #334155; border-radius:6px; cursor:crosshair; touch-action:none;"></canvas>
            <div style="font-size:0.8rem; color:var(--muted); line-height:1.5; flex:1; min-width:200px;">
              <div>🔵 <b>A:起點</b> ｜ 🟢 <b>B:終點</b> ｜ 🟡 <b>S:主體</b>（直接拖曳圓點）</div>
              <div style="margin:6px 0; display:flex; gap:6px; flex-wrap:wrap; align-items:center;">快速預設：
                <button type="button" onclick="setStagingPreset(this, 'dolly_in')" style="padding:5px 10px; font-size:0.78rem; min-height:34px;">推近 (Dolly In)</button>
                <button type="button" onclick="setStagingPreset(this, 'pull_back')" style="padding:5px 10px; font-size:0.78rem; min-height:34px;">拉遠 (Pull Back)</button>
                <button type="button" onclick="setStagingPreset(this, 'orbit')" style="padding:5px 10px; font-size:0.78rem; min-height:34px;">環繞 (Orbit)</button>
                <button type="button" onclick="setStagingPreset(this, 'truck_right')" style="padding:5px 10px; font-size:0.78rem; min-height:34px;">右移 (Truck)</button>
              </div>
              <div class="staging-preview-text" style="color:#e2e8f0; font-style:italic; margin:6px 0; min-height:2.2em;"></div>
              <button type="button" onclick="applyStagingToCard(this)" style="padding:6px 12px; font-size:0.8rem; min-height:36px; background:#0284c7; color:#fff; border-radius:6px; border:none; cursor:pointer;">✨ 套用運鏡至 Camera 與 Prompt</button>
            </div>
          </div>
        </details>
        <details open class="seg-raw-prompt-details" style="margin:4px 0 2px 0; font-size:0.82rem; background:rgba(15,23,42,0.35); border:1px solid rgba(148,163,184,0.2); border-radius:6px; padding:6px 10px;">
          <summary style="cursor:pointer; color:#cbd5e1; font-weight:600; display:flex; align-items:center; justify-content:space-between; user-select:none;">
            <span>🧾 原始 5D 分鏡提示詞（可直接微調）</span>
            <span style="font-size:0.74rem; color:#94a3b8;">收合／展開 ▾</span>
          </summary>
          <textarea class="seg-prompt-input" oninput="onRawPromptInput(this)" rows="4" style="margin-top:6px;"></textarea>
        </details>
      `;
  const promptTa = div.querySelector<HTMLTextAreaElement>(".seg-prompt-input");
  if (promptTa) {
    promptTa.value = seg.prompt || "";
  }
  container.appendChild(div);
  const dialInput = div.querySelector<HTMLInputElement>(".seg-dialogue-input");
  if (dialInput) {
    onShotDialogueInput(dialInput);
  }
}

export function updateSinglePromptSection(rawPrompt: string, fieldKey: string, newValue: string): string {
  const val = String(newValue || "")
    .trim()
    .replace(/\.+$/, "");
  if (!val) return rawPrompt;
  const patterns: Record<string, { re: RegExp; tag: string }> = {
    scene: { re: /(\[Scene\]\s*)([\s\S]*?)(?=\s*(?:\[Camera\]|Timeline:|\[Look\]|Audio:|$))/i, tag: "[Scene]" },
    camera: { re: /(\[Camera\]\s*)([\s\S]*?)(?=\s*(?:Timeline:|\[Look\]|Audio:|$))/i, tag: "[Camera]" },
    action: { re: /(Timeline:\s*)([\s\S]*?)(?=\s*(?:\[Look\]|Audio:|$))/i, tag: "Timeline:" },
    look: { re: /(\[Look\]\s*)([\s\S]*?)(?=\s*(?:Audio:|$))/i, tag: "[Look]" },
    audio: { re: /(Audio:\s*)([\s\S]*?)$/i, tag: "Audio:" },
  };
  const spec = patterns[fieldKey];
  if (!spec) return rawPrompt;
  if (spec.re.test(rawPrompt)) {
    return rawPrompt.replace(spec.re, `$1${val}. `);
  }
  return `${rawPrompt.trim()} ${spec.tag} ${val}.`.trim();
}

export function onSingleIRFieldInput(inputEl: HTMLInputElement, fieldKey: string): void {
  const card = inputEl.closest(".segment-card");
  if (!card) return;
  const promptEl = card.querySelector<HTMLTextAreaElement>(".seg-prompt-input");
  if (promptEl) {
    promptEl.value = updateSinglePromptSection(promptEl.value, fieldKey, inputEl.value);
  }
  syncSegmentsFromDOM();
}

export function onRawPromptInput(textareaEl: HTMLTextAreaElement): void {
  const card = textareaEl.closest(".segment-card");
  if (!card) return;
  if (typeof window.H3PromptBuilder !== "undefined" && window.H3PromptBuilder.parseContextIRFromPrompt) {
    const parsed = window.H3PromptBuilder.parseContextIRFromPrompt(textareaEl.value);
    const map: Record<string, string> = { scene: ".ir-scene", camera: ".ir-camera", action: ".ir-action", look: ".ir-look", audio: ".ir-audio" };
    Object.keys(map).forEach((k) => {
      const el = card.querySelector<HTMLInputElement>(map[k]);
      if (el && parsed[k]) el.value = parsed[k];
    });
  }
  syncSegmentsFromDOM();
}

export function applyContextIRToCard(btnEl: HTMLElement, idx: number): void {
  const card = btnEl.closest<PromptBackupCard>(".segment-card");
  if (!card) return;
  const fields = {
    scene: card.querySelector<HTMLInputElement>(".ir-scene")?.value || "",
    camera: card.querySelector<HTMLInputElement>(".ir-camera")?.value || "",
    action: card.querySelector<HTMLInputElement>(".ir-action")?.value || "",
    look: card.querySelector<HTMLInputElement>(".ir-look")?.value || "",
    audio: card.querySelector<HTMLInputElement>(".ir-audio")?.value || "",
  };
  const promptEl = card.querySelector<HTMLTextAreaElement>(".seg-prompt-input");
  if (!promptEl) return;
  card._lastPromptBackup = promptEl.value;
  const undoBtn = card.querySelector<HTMLElement>(".ir-undo-btn");
  if (undoBtn) undoBtn.style.display = "inline-flex";
  const compiled =
    typeof window.H3PromptBuilder !== "undefined" && window.H3PromptBuilder.compileContextIR
      ? window.H3PromptBuilder.compileContextIR(fields, idx)
      : `[Scene] ${fields.scene}. [Camera] ${fields.camera}. Timeline: ${fields.action}. [Look] ${fields.look}. Audio: ${fields.audio}.`;
  promptEl.value = lintH3PromptText(compiled);
  syncSegmentsFromDOM();
  showToast("✨ 已根據 5D 欄位重組 Prompt（可點「↩️ 復原」還原）");
}

export function undoPromptOverwrite(btnEl: HTMLElement): void {
  const card = btnEl.closest<PromptBackupCard>(".segment-card");
  if (!card || typeof card._lastPromptBackup !== "string") return;
  const promptEl = card.querySelector<HTMLTextAreaElement>(".seg-prompt-input");
  if (promptEl) {
    promptEl.value = card._lastPromptBackup;
    onRawPromptInput(promptEl);
  }
  btnEl.style.display = "none";
  showToast("↩️ 已復原上一版 Prompt");
}

export function addSegmentCard(): void {
  if (!storyboardStore.getState().currentPlan) {
    storyboardStore.setPlan({ project_slug: "custom_story", recommended_total_seconds: 5, reasoning_zh: "", expanded_story_zh: "", segments: [] });
    document.getElementById("segmentsContainer")!.innerHTML = "";
  }
  const isEdu = coreStore.getState().activeProjectMode === "edu";
  const nextIdx = document.querySelectorAll("#segmentsContainer .segment-card").length;
  const totalEstimated = nextIdx + 1;
  const defaultPanel =
    typeof window.H3TimecodeHelper !== "undefined"
      ? window.H3TimecodeHelper.calculateDefaultEndPanel(nextIdx, totalEstimated)
      : Math.min(9, (nextIdx + 1) * 3);
  const defaultTitle = isEdu
    ? `Part ${nextIdx + 1} (教學分鏡)`
    : typeof window.H3TimecodeHelper !== "undefined"
      ? window.H3TimecodeHelper.formatSegmentTitle(nextIdx)
      : `Part ${nextIdx + 1} (${nextIdx * 5}-${(nextIdx + 1) * 5}s)`;
  const defaultPrompt = isEdu
    ? "Japanese anime aesthetic, hand-drawn educational scene. Audio: clear Mandarin studio voice, soft acoustic piano background music, <d>[Chinese] </d>."
    : "Create a 5-second live-action cinematic film continuing seamlessly from the first frame to the last frame.";

  appendSegmentCardDOM(
    {
      title: defaultTitle,
      end_panel: defaultPanel,
      shot_type: isEdu ? "presenter_chart" : undefined,
      frames: 124,
      dialogue: "",
      chain_mode: isEdu ? "motion_context" : undefined,
      prompt: defaultPrompt,
    },
    nextIdx
  );
  syncSegmentsFromDOM();
}

export function removeSegmentCard(btnEl: HTMLElement): void {
  btnEl.closest(".segment-card")?.remove();
  syncSegmentsFromDOM();
}

export function onShotTypeChange(selectEl: HTMLSelectElement): void {
  const card = selectEl.closest(".segment-card");
  if (!card) return;
  const shotType = selectEl.value;
  const promptEl = card.querySelector<HTMLTextAreaElement>(".seg-prompt-input");
  const speakerVisual = (document.getElementById("eduSpeakerVisualInput") as HTMLInputElement | null)?.value || "consistent presenter visible in side-profile";
  const acousticAnchor = (document.getElementById("eduAcousticAnchorInput") as HTMLInputElement | null)?.value || "clear Mandarin studio voice";

  if (promptEl) {
    let p = promptEl.value;
    if (shotType === "presenter_chart") {
      if (!p.includes(speakerVisual)) {
        p = p.replace(/\.\s*(?=Audio:|$)/, `, with ${speakerVisual}. `);
      }
    } else if (shotType === "pure_b_roll") {
      if (p.includes(speakerVisual)) {
        p = p.replace(`, with ${speakerVisual}`, "");
      }
      if (!p.includes(acousticAnchor)) {
        p = p.replace(/Audio:\s*/, `Audio: ${acousticAnchor}, `);
      }
    }
    promptEl.value = p;
  }
  syncSegmentsFromDOM();
}

export function onShotFramesChange(): void {
  syncSegmentsFromDOM();
}

export function splitSegmentCardInTwo(btnEl: HTMLElement): void {
  const card = btnEl.closest(".segment-card");
  if (!card) return;
  const dialogueInput = card.querySelector<HTMLInputElement>(".seg-dialogue-input");
  const fullText = (dialogueInput?.value || "").trim();
  if (!fullText) return;

  const mid = Math.floor(fullText.length / 2);
  let cutIdx = -1;
  const puncts = ["，", ",", "、", "；", ";", "。", " "];
  for (let offset = 0; offset < mid; offset++) {
    if (puncts.includes(fullText[mid + offset])) {
      cutIdx = mid + offset + 1;
      break;
    }
    if (puncts.includes(fullText[mid - offset])) {
      cutIdx = mid - offset + 1;
      break;
    }
  }
  if (cutIdx === -1) cutIdx = mid;

  const part1 = fullText.slice(0, cutIdx).trim();
  const part2 = fullText.slice(cutIdx).trim();

  if (dialogueInput) {
    dialogueInput.value = part1;
    onShotDialogueInput(dialogueInput);
  }

  const cards = Array.from(document.querySelectorAll("#segmentsContainer .segment-card"));
  const currentIdx = cards.indexOf(card);

  appendSegmentCardDOM(
    {
      title: `Part ${currentIdx + 2} (拆分鏡)`,
      shot_type: card.querySelector<HTMLSelectElement>(".seg-shot-type-select")?.value || "presenter_chart",
      dialogue: part2,
      chain_mode: "motion_context",
      prompt: `Create a cinematic film continuing seamlessly. [Scene] Same scene. Audio: <d>[Chinese] ${part2}</d>.`,
    },
    currentIdx + 1
  );

  const newCard = document.querySelector("#segmentsContainer .segment-card:last-child");
  if (newCard && card.nextSibling && card.parentNode) {
    card.parentNode.insertBefore(newCard, card.nextSibling);
  }

  syncSegmentsFromDOM();
  showToast("✂️ 已一鍵將過長台詞拆分為 2 個分鏡！");
}

export function rerollSingleShot(shotNum: number): void {
  const currentPlan = storyboardStore.getState().currentPlan;
  const manifestFile = currentPlan && currentPlan.project_slug ? `storyboards/${currentPlan.project_slug}.json` : "edu_storyboard_manifest.json";
  const cmd = `python3 -m pipeline.h3_cli run --route local --manifest ${manifestFile} --only-shots ${shotNum}`;
  copyTextToClipboard(cmd, `📋 已複製 Shot ${shotNum} 局部重抽指令！可直接於終端機執行或呼叫本地引擎。`);
}

export function exportEduManifestJson(): void {
  const manifest = exportChainedManifest();
  if (!manifest) {
    showToast("⚠️ 請先在步驟二建立至少 1 個分鏡！");
    return;
  }
  const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "edu_storyboard_manifest.json";
  a.click();
  URL.revokeObjectURL(url);
  showToast("💾 已匯出 edu_storyboard_manifest.json！");
}

export function copyEduPipelineCliCommand(): void {
  const cmd =
    window.H3Prompts && typeof window.H3Prompts.buildEduLocalCliCommand === "function"
      ? window.H3Prompts.buildEduLocalCliCommand("edu_storyboard_manifest.json", "outputs/edu_lecture.state.json")
      : "python3 -m pipeline.h3_cli validate-manifest --manifest edu_storyboard_manifest.json && python3 -m pipeline.h3_cli plan --manifest edu_storyboard_manifest.json --route local --state-file outputs/edu_lecture.state.json";
  copyTextToClipboard(cmd, "📋 已複製教學長片統一 H3 CLI 執行指令！");
}

export function syncSegmentsFromDOM(silent = false): StoryboardSegment[] {
  const currentPlan = storyboardStore.getState().currentPlan;
  if (!currentPlan) return [];
  const prevSegs = currentPlan.segments || [];
  const cards = document.querySelectorAll("#segmentsContainer .segment-card");
  if (silent && cards.length === 0 && prevSegs.length > 0) {
    return prevSegs;
  }
  const segs: StoryboardSegment[] = [];
  cards.forEach((card, i) => {
    const modeSelect = card.querySelector<HTMLSelectElement>(".seg-chain-mode-select");
    const chainMode = modeSelect ? modeSelect.value : i === 0 ? "first_frame" : "motion_context";
    const shotTypeSelect = card.querySelector<HTMLSelectElement>(".seg-shot-type-select");
    const dialogueInput = card.querySelector<HTMLInputElement>(".seg-dialogue-input");
    const framesSelect = card.querySelector<HTMLSelectElement>(".seg-frames-select");
    const shotType = shotTypeSelect ? shotTypeSelect.value : prevSegs[i]?.shot_type || "presenter_focus";
    const dialogue = dialogueInput ? dialogueInput.value.trim() : prevSegs[i]?.dialogue || "";
    const frames = framesSelect ? parseInt(framesSelect.value, 10) || 124 : prevSegs[i]?.frames || 124;

    const irFields = {
      scene: card.querySelector<HTMLInputElement>(".ir-scene")?.value.trim() || "",
      camera: card.querySelector<HTMLInputElement>(".ir-camera")?.value.trim() || "",
      action: card.querySelector<HTMLInputElement>(".ir-action")?.value.trim() || "",
      look: card.querySelector<HTMLInputElement>(".ir-look")?.value.trim() || "",
      audio: card.querySelector<HTMLInputElement>(".ir-audio")?.value.trim() || "",
    };
    const hasIr = Object.values(irFields).some(Boolean);
    const canvas = card.querySelector<TrackCanvasElement>(".staging-canvas");
    const track =
      canvas && canvas._track
        ? {
            start: [canvas._track.start.x, canvas._track.start.y],
            end: [canvas._track.end.x, canvas._track.end.y],
            subject: [canvas._track.subject.x, canvas._track.subject.y],
          }
        : undefined;
    segs.push({
      segment: i + 1,
      shot_id: i + 1,
      shot_type: shotType,
      dialogue,
      frames,
      title: card.querySelector<HTMLInputElement>(".seg-title-input")?.value.trim() || `Part ${i + 1}`,
      end_panel: parseInt(card.querySelector<HTMLSelectElement>(".seg-panel-select")?.value || "", 10) || 9,
      chain_mode: chainMode,
      first_frame: prevSegs[i]?.first_frame,
      context_ir: hasIr ? irFields : prevSegs[i]?.context_ir,
      camera_track: track || prevSegs[i]?.camera_track,
      prompt: card.querySelector<HTMLTextAreaElement>(".seg-prompt-input")?.value.trim() || "",
    });
  });
  storyboardStore.updateSegments(segs);
  if (!silent) {
    updateDurationBadge();
    renderChainTimelineBar();
  }
  return segs;
}

export function exportChainedManifest(silent = false): Record<string, any> | null {
  const segs = syncSegmentsFromDOM(silent);
  if (!segs || segs.length === 0) {
    return null;
  }
  const { currentPlan, refImageBase64 } = storyboardStore.getState();
  const selectedSpeed = computeStore.getState().selectedSpeed;
  const activeProjectMode = coreStore.getState().activeProjectMode;
  const slug = (currentPlan && currentPlan.project_slug) || "custom_storyboard";
  const title = (currentPlan && (currentPlan.title as string)) || slug;
  const defaultAnchor = (currentPlan && currentPlan.anchor_ref_image) || "examples/assets/detective_anchor_ref.jpg";
  const refImgEl = document.getElementById("refPreview") as HTMLImageElement | null;
  const hasCustomRefImage = Boolean(
    refImageBase64 ||
      (refImgEl && refImgEl.style.display !== "none" && refImgEl.getAttribute("src")?.startsWith("data:"))
  );
  const refImg = hasCustomRefImage ? "reference_character.png" : defaultAnchor;
  const speedCfg = SPEED_CONFIGS[selectedSpeed] || SPEED_CONFIGS.quality;
  const isEdu = activeProjectMode === "edu" || currentPlan?.project_mode === "edu_explainer";

  const manifest: Record<string, any> = {
    title,
    project_mode: isEdu ? "edu_explainer" : undefined,
    auto_duration: isEdu ? true : false,
    mode: speedCfg.mode || (currentPlan && (currentPlan.mode as string)) || "turbo",
    width: speedCfg.width || 864,
    height: speedCfg.height || 480,
    frames: 124,
    steps: speedCfg.steps || 6,
    layers: parseInt(speedCfg.layers, 10) || 50,
    reuse: speedCfg.reuse ?? 0,
    seed: (currentPlan && (currentPlan.seed as number)) || 20261106,
    output_prefix: `storyboard_runs/${slug.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
    anchor_ref_image: refImg,
    global_profile: isEdu
      ? {
          language_code: (document.getElementById("eduLangCodeSelect") as HTMLSelectElement | null)?.value || "zh-TW",
          acoustic_anchor:
            (document.getElementById("eduAcousticAnchorInput") as HTMLInputElement | null)?.value ||
            "clear Mandarin studio voice, steady professional narrator tone, natural pacing",
          speaker_visual_anchor:
            (document.getElementById("eduSpeakerVisualInput") as HTMLInputElement | null)?.value ||
            "consistent presenter visible in side-profile or corner frame speaking clearly",
          bgm_style:
            (document.getElementById("eduBgmStyleInput") as HTMLInputElement | null)?.value ||
            "soft acoustic piano background music, warm Japanese anime soundtrack",
        }
      : undefined,
    shots: isEdu
      ? segs.map((s, idx) => ({
          shot_id: idx + 1,
          shot_type: s.shot_type || "presenter_chart",
          dialogue: s.dialogue || s.display_dialogue || "",
          display_dialogue: s.display_dialogue || s.dialogue || "",
          spoken_dialogue: applyPhoneticSubstitutions(s.spoken_dialogue || s.dialogue || ""),
          frames: s.frames || 124,
          first_frame: idx === 0 ? s.first_frame || refImg : undefined,
          visual_prompt: s.prompt || "",
          prompt: s.prompt || "",
        }))
      : undefined,
    segments: segs.map((s, idx) => ({
      segment: idx + 1,
      shot_id: idx + 1,
      shot_type: s.shot_type || "presenter_chart",
      dialogue: s.dialogue || s.display_dialogue || "",
      display_dialogue: s.display_dialogue || s.dialogue || "",
      spoken_dialogue: applyPhoneticSubstitutions(s.spoken_dialogue || s.dialogue || ""),
      frames: s.frames || 124,
      title: s.title || `Part ${idx + 1}`,
      chain_mode: s.chain_mode || (idx === 0 ? "first_frame" : "motion_context"),
      first_frame: idx === 0 ? s.first_frame || refImg : undefined,
      context_ir: s.context_ir,
      camera_track: s.camera_track,
      prompt: s.prompt || "Cinematic film continuing seamlessly.",
    })),
  };
  Object.keys(manifest).forEach((k) => manifest[k] === undefined && delete manifest[k]);
  return manifest;
}

export function updateDurationBadge(): void {
  const cards = Array.from(document.querySelectorAll("#segmentsContainer .segment-card"));
  const currentPlan = storyboardStore.getState().currentPlan;
  const count = cards.length || (currentPlan?.segments?.length || 0);
  const isEdu = coreStore.getState().activeProjectMode === "edu";

  let totalSec = 0;
  let runningSec = 0;

  if (isEdu) {
    cards.forEach((card) => {
      const framesSelect = card.querySelector<HTMLSelectElement>(".seg-frames-select");
      const frames = framesSelect ? parseInt(framesSelect.value, 10) || 124 : 124;
      const sec = Math.floor((frames / 24) * 10) / 10;
      const startSec = Math.round(runningSec * 10) / 10;
      runningSec += sec;
      const endSec = Math.round(runningSec * 10) / 10;

      const timePill = card.querySelector(".time-pill");
      if (timePill) {
        timePill.textContent = `⏱️ ${startSec} - ${endSec}s (${frames}f)`;
      }
    });
    totalSec = Math.round(runningSec * 10) / 10;
  } else {
    totalSec = typeof window.H3TimecodeHelper !== "undefined" ? window.H3TimecodeHelper.calculateTotalSeconds(count) : count * 5;
    cards.forEach((card, idx) => {
      const timePill = card.querySelector(".time-pill");
      if (timePill) {
        timePill.textContent = `⏱️ ${idx * 5} - ${(idx + 1) * 5}s`;
      }
    });
  }

  const b2 = document.getElementById("totalDurationBadge");
  if (b2) {
    if (isEdu && totalSec >= 60) {
      const mins = Math.floor(totalSec / 60);
      const remSecs = Math.round((totalSec % 60) * 10) / 10;
      b2.textContent = `共 ${count} 段，總長 ${mins} 分 ${remSecs} 秒 (${totalSec}s)`;
    } else {
      b2.textContent = `共 ${count} 段，總長 ${totalSec} 秒`;
    }
  }

  const b4 = document.getElementById("step4SegmentsBadge");
  if (b4) b4.textContent = `共 ${count} 段個別影片 ＋ 1 支完整彙整總片`;

  renderColabPipelineTracker();
  updateLocalRenderEstimateUI();
}

export function confirmStep2AndProceed(): void {
  const segs = syncSegmentsFromDOM();
  if (!segs.length) {
    showToast("⚠️ 請先至少保留或新增 1 個分鏡段落！");
    return;
  }
  scheduleAutoSave();
  updateStep3UI();
  publishSessionManifestAndImage();
  const m = buildColabCompatibleManifest();
  const handoffBadge = document.getElementById("step3HandoffStatusBadge");
  const durBadge = document.getElementById("totalDurationBadge");
  if (handoffBadge) {
    handoffBadge.textContent = `✅ 已確認分鏡：${durBadge ? durBadge.textContent : `共 ${segs.length} 段`}${m && m.revision ? " · " + m.revision : ""}`;
    handoffBadge.style.borderColor = "#10b981";
    handoffBadge.style.color = "#6ee7b7";
    handoffBadge.style.background = "rgba(16,185,129,0.16)";
  }
  showToast(`✅ 已確認並同步最新分鏡（共 ${segs.length} 段），可於步驟三執行渲染或下載任務檔！`);
  document.getElementById("step3Card")?.scrollIntoView({ behavior: "smooth" });
}

export async function replanCurrentSegmentsViaAI(): Promise<void> {
  const segs = syncSegmentsFromDOM();
  const count = segs.length || 3;
  const currentSeconds = Math.max(5, count * 5);
  const desc = (document.getElementById("chineseDesc") as HTMLTextAreaElement).value.trim();
  const prefs = getPrefs();
  const promptProv = (document.getElementById("promptProviderSelect") as HTMLSelectElement).value;
  const replanBtn = document.getElementById("replanBtn") as HTMLButtonElement;

  if (!desc) {
    showToast("⚠️ 請先在步驟一輸入原始的「中文情節描述」！");
    document.getElementById("chineseDesc")?.focus();
    return;
  }

  const confirmMsg = `AI 即將參考原始中文情節描述，依當前修改後總秒數【${currentSeconds} 秒（共 ${count} 段）】重新規劃分鏡劇情與各段 Prompt。\n\n是否繼續？`;
  if (!confirm(confirmMsg)) return;

  replanBtn.disabled = true;
  const originalText = replanBtn.textContent;
  replanBtn.textContent = `⏳ AI 重新規劃 ${currentSeconds}s 劇本中...`;

  try {
    const chainParadigm = (document.getElementById("chainParadigmSelect") as HTMLSelectElement | null)?.value || "latent_chain";
    const sysPrompt = buildDirectorSystemPrompt("expand", currentSeconds, chainParadigm);
    if (promptProv === "agent-llm") {
      replanBtn.disabled = false;
      replanBtn.textContent = originalText;
      const packageText = document.getElementById("agentPlanPackTextarea") as HTMLTextAreaElement | null;
      const box = document.getElementById("agentPlanPackBox");
      if (box && packageText) {
        packageText.value = buildAgentPlanTaskPack(desc, "expand", currentSeconds, chainParadigm);
        box.style.display = "block";
      }
      copyTextToClipboard(
        box && packageText ? packageText.value : "",
        "📋 已複製 Agent 重新規劃任務包！貼給你的 Agent，回傳 JSON 後點「📄 貼上 Agent 分鏡 JSON」（選「覆蓋全部分鏡」）"
      );
      return;
    }

    const plan = await dispatchPlanByProvider({
      promptProvider: promptProv,
      desc,
      durationMode: "custom",
      targetSec: currentSeconds,
      sysPrompt,
      prefs,
    });

    if (plan && plan.segments && plan.segments.length > 0) {
      const currentPlan = storyboardStore.getState().currentPlan;
      if (currentPlan) {
        const nextPlan: StoryboardPlan = {
          ...currentPlan,
          reasoning_zh: plan.reasoning_zh,
          expanded_story_zh: plan.expanded_story_zh,
          segments: plan.segments,
        };
        storyboardStore.setPlan(nextPlan);
        renderPlanUI(nextPlan);
      } else {
        storyboardStore.setPlan(plan);
        renderPlanUI(plan);
      }
      showToast(`✅ 已成功依 ${currentSeconds} 秒重新規劃 ${plan.segments.length} 段分鏡腳本！`);
    } else {
      throw new Error("AI 回傳的腳本結構不完整，請重試");
    }
  } catch (err: unknown) {
    showToast(`❌ 重設分鏡失敗：${formatDiagnosticError(err, promptProv).plainText}`);
  } finally {
    replanBtn.disabled = false;
    replanBtn.textContent = originalText;
  }
}
