import type { ComputeRoute, ProjectMode, SpeedKey } from "../types/studio.ts";
import {
  DEFAULT_CLOUD_VIDEO_BASE_URL,
  DEFAULT_CLOUD_VIDEO_MODEL,
  DEFAULT_COMFY_URL,
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENAI_MODEL,
  STORAGE_KEYS,
  TIMING_CONSTANTS,
} from "../config/constants.ts";
import { escapeHtml, sanitizeTrustedTooltipHtml } from "../utils/domSafety.ts";
import { coreStore } from "../stores/coreStore.ts";
import { computeStore } from "../stores/computeStore.ts";
import { storyboardStore } from "../stores/storyboardStore.ts";
import { getOrCreateSessionId, renderColabPipelineTracker, updateColabPromptText } from "./sessionColab.ts";
import { loadGoldenTemplate } from "./director.ts";
import { refreshAllSegmentCardModeUI, renderChainTimelineBar, updateDurationBadge } from "./storyboardEditor.ts";
import { checkComfyConnection } from "./dispatchLocalComfy.ts";
import { syncCloudKeyUI, updateCloudCostEstimate } from "./dispatchCloudApi.ts";

let toastHideTimer: ReturnType<typeof setTimeout> | null = null;

export { escapeHtml };

export function playCompletionChime(): void {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.setValueAtTime(880.0, ctx.currentTime + 0.14);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => {
      if (typeof ctx.close === "function") {
        void ctx.close().catch((closeErr) => console.debug("Audio chime close skipped:", closeErr));
      }
    };
    osc.start();
    osc.stop(ctx.currentTime + 0.8);
  } catch (err) {
    console.debug("Audio chime skipped:", err);
  }
}

export function showToast(message: string, duration = TIMING_CONSTANTS.TOAST_DEFAULT_DURATION_MS): void {
  let toast = document.getElementById("filmChainToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "filmChainToast";
    toast.style.position = "fixed";
    toast.style.top = "24px";
    toast.style.left = "50%";
    toast.style.transform = "translateX(-50%) translateY(-20px)";
    toast.style.background = "linear-gradient(135deg, #1e293b, #0f172a)";
    toast.style.border = "1.5px solid #38bdf8";
    toast.style.boxShadow = "0 10px 25px rgba(0,0,0,0.5), 0 0 16px rgba(56,189,248,0.35)";
    toast.style.color = "#f8fafc";
    toast.style.padding = "10px 22px";
    toast.style.borderRadius = "30px";
    toast.style.fontSize = "0.88rem";
    toast.style.fontWeight = "600";
    toast.style.zIndex = "99999";
    toast.style.opacity = "0";
    toast.style.transition = "all 0.28s cubic-bezier(0.16, 1, 0.3, 1)";
    toast.style.pointerEvents = "none";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.opacity = "1";
  toast.style.transform = "translateX(-50%) translateY(0)";
  if (toastHideTimer) clearTimeout(toastHideTimer);
  toastHideTimer = setTimeout(() => {
    if (!toast) return;
    toast.style.opacity = "0";
    toast.style.transform = "translateX(-50%) translateY(-15px)";
  }, duration);
}

export function fallbackCopyText(
  textarea: HTMLTextAreaElement | HTMLInputElement,
  onSuccess?: () => void
): void {
  try {
    textarea.select();
    textarea.setSelectionRange(0, 99999);
    const successful = document.execCommand("copy");
    if (successful && onSuccess) {
      onSuccess();
    } else if (!successful) {
      showToast("⚠️ 複製失敗，請手動全選下方方框複製。");
    }
  } catch (err: any) {
    showToast("⚠️ 複製失敗，請手動全選下方方框複製：" + (err?.message || String(err)));
  }
}

export function copyTextToClipboard(text: string, successMsg: string): void {
  function onCopySuccess(): void {
    showToast(successMsg);
  }
  function onCopyFail(): void {
    showToast("⚠️ 自動複製失敗，請手動全選任務包文字複製");
  }
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(onCopySuccess).catch(onCopyFail);
  } else {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      ta.style.top = "0";
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, 99999);
      if (document.execCommand("copy")) onCopySuccess();
      else onCopyFail();
      ta.remove();
    } catch (_e) {
      onCopyFail();
    }
  }
}

export function getPrefs() {
  const storedPromptProv = localStorage.getItem(STORAGE_KEYS.PROMPT_PROVIDER) || "agent-llm";
  const storedImageProv = localStorage.getItem(STORAGE_KEYS.IMAGE_PROVIDER) || "agent-image";
  return {
    geminiKey: localStorage.getItem(STORAGE_KEYS.GEMINI_KEY) || "",
    openaiKey: localStorage.getItem(STORAGE_KEYS.OPENAI_KEY) || "",
    openaiBaseUrl: (localStorage.getItem(STORAGE_KEYS.OPENAI_BASE) || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, ""),
    openaiModel: localStorage.getItem(STORAGE_KEYS.OPENAI_MODEL) || DEFAULT_OPENAI_MODEL,
    falKey: localStorage.getItem(STORAGE_KEYS.FAL_KEY) || "",
    minimaxKey: localStorage.getItem(STORAGE_KEYS.MINIMAX_KEY) || "",
    cloudVideoKey: localStorage.getItem(STORAGE_KEYS.CLOUD_VIDEO_KEY) || "",
    cloudVideoBaseUrl: (localStorage.getItem(STORAGE_KEYS.CLOUD_VIDEO_BASE) || DEFAULT_CLOUD_VIDEO_BASE_URL).replace(/\/+$/, ""),
    cloudVideoModel: localStorage.getItem(STORAGE_KEYS.CLOUD_VIDEO_MODEL) || DEFAULT_CLOUD_VIDEO_MODEL,
    comfyUrl: (localStorage.getItem(STORAGE_KEYS.COMFY_URL) || DEFAULT_COMFY_URL).replace(/\/+$/, ""),
    promptProvider:
      ((storedPromptProv === "gemini" || storedPromptProv === "gemini-pro") && !localStorage.getItem(STORAGE_KEYS.GEMINI_KEY)) ||
      (storedPromptProv === "openai" && !localStorage.getItem(STORAGE_KEYS.OPENAI_KEY))
        ? "agent-llm"
        : storedPromptProv,
    imageProvider:
      (storedImageProv.startsWith("nano-banana") && !localStorage.getItem(STORAGE_KEYS.GEMINI_KEY)) ||
      (storedImageProv === "openai-image" && !localStorage.getItem(STORAGE_KEYS.OPENAI_KEY))
        ? "agent-image"
        : storedImageProv,
  };
}

export function saveLocalPrefs(): void {
  const promptSel = document.getElementById("promptProviderSelect") as HTMLSelectElement | null;
  const imgSel = document.getElementById("imageProviderSelect") as HTMLSelectElement | null;
  if (promptSel) localStorage.setItem(STORAGE_KEYS.PROMPT_PROVIDER, promptSel.value);
  localStorage.setItem(STORAGE_KEYS.IMAGE_PROVIDER, imgSel?.value || "agent-image");
}

export function onPromptProviderChange(): void {
  saveLocalPrefs();
  const hint = document.getElementById("agentWriteHint");
  const sel = document.getElementById("promptProviderSelect") as HTMLSelectElement | null;
  if (hint && sel) hint.style.display = sel.value === "agent-llm" ? "block" : "none";
}

export function showInfoTipModal(htmlContent: string): void {
  const modal = document.getElementById("infoTipDialog") as HTMLDialogElement | null;
  const body = document.getElementById("infoTipDialogBody");
  const title = document.getElementById("infoTipDialogTitle");
  if (!modal || !body) return;

  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = sanitizeTrustedTooltipHtml(htmlContent);
  const strongEl = tempDiv.querySelector("strong");
  if (strongEl && title) {
    title.textContent = strongEl.textContent || "ℹ️ 說明提示";
    strongEl.remove();
  } else if (title) {
    title.textContent = "ℹ️ 說明提示";
  }
  body.innerHTML = tempDiv.innerHTML.trim();
  modal.showModal();
}

export function closeInfoTipModal(): void {
  const modal = document.getElementById("infoTipDialog") as HTMLDialogElement | null;
  if (modal && modal.open) {
    modal.close();
  }
}

let infoTipEventsBound = false;

export function bindInfoTipGlobalEvents(): void {
  if (infoTipEventsBound || typeof document === "undefined") return;
  infoTipEventsBound = true;

  document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement | null;
    const tip = target ? target.closest(".info-tip") : null;
    if (!tip) {
      document.querySelectorAll(".info-tip.pinned").forEach((el) => el.classList.remove("pinned"));
      return;
    }

    const tooltip = tip.querySelector(".tooltip-content");
    if (!tooltip) return;

    e.preventDefault();
    e.stopPropagation();
    showInfoTipModal(tooltip.innerHTML);
  });

  document.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement | null;
    if ((e.key === "Enter" || e.key === " ") && target?.classList && target.classList.contains("info-tip")) {
      const tooltip = target.querySelector(".tooltip-content");
      if (tooltip) {
        e.preventDefault();
        showInfoTipModal(tooltip.innerHTML);
      }
    }
  });
}

export function openSettingsModal(): void {
  const p = getPrefs();
  (document.getElementById("geminiKeyInput") as HTMLInputElement).value = p.geminiKey;
  (document.getElementById("openaiKeyInput") as HTMLInputElement).value = p.openaiKey;
  (document.getElementById("openaiBaseUrlInput") as HTMLInputElement).value = p.openaiBaseUrl;
  (document.getElementById("openaiModelInput") as HTMLInputElement).value = p.openaiModel;
  const falEl = document.getElementById("falKeyInput") as HTMLInputElement | null;
  if (falEl) falEl.value = p.falKey;
  const mmEl = document.getElementById("minimaxKeyInput") as HTMLInputElement | null;
  if (mmEl) mmEl.value = p.minimaxKey;
  (document.getElementById("cloudVideoKeyInput") as HTMLInputElement).value = p.cloudVideoKey;
  (document.getElementById("cloudVideoBaseUrlInput") as HTMLInputElement).value = p.cloudVideoBaseUrl;
  (document.getElementById("cloudVideoModelInput") as HTMLInputElement).value = p.cloudVideoModel;
  (document.getElementById("comfyUrlInput") as HTMLInputElement).value = p.comfyUrl;
  (document.getElementById("settingsDialog") as HTMLDialogElement).showModal();
}

export function saveSettingsModal(): void {
  localStorage.setItem(STORAGE_KEYS.GEMINI_KEY, (document.getElementById("geminiKeyInput") as HTMLInputElement).value.trim());
  localStorage.setItem(STORAGE_KEYS.OPENAI_KEY, (document.getElementById("openaiKeyInput") as HTMLInputElement).value.trim());
  localStorage.setItem(STORAGE_KEYS.OPENAI_BASE, (document.getElementById("openaiBaseUrlInput") as HTMLInputElement).value.trim());
  localStorage.setItem(STORAGE_KEYS.OPENAI_MODEL, (document.getElementById("openaiModelInput") as HTMLInputElement).value.trim());
  const falEl = document.getElementById("falKeyInput") as HTMLInputElement | null;
  if (falEl) localStorage.setItem(STORAGE_KEYS.FAL_KEY, falEl.value.trim());
  const mmEl = document.getElementById("minimaxKeyInput") as HTMLInputElement | null;
  if (mmEl) localStorage.setItem(STORAGE_KEYS.MINIMAX_KEY, mmEl.value.trim());
  localStorage.setItem(STORAGE_KEYS.CLOUD_VIDEO_KEY, (document.getElementById("cloudVideoKeyInput") as HTMLInputElement).value.trim());
  localStorage.setItem(STORAGE_KEYS.CLOUD_VIDEO_BASE, (document.getElementById("cloudVideoBaseUrlInput") as HTMLInputElement).value.trim());
  localStorage.setItem(STORAGE_KEYS.CLOUD_VIDEO_MODEL, (document.getElementById("cloudVideoModelInput") as HTMLInputElement).value.trim());
  localStorage.setItem(STORAGE_KEYS.COMFY_URL, (document.getElementById("comfyUrlInput") as HTMLInputElement).value.trim());
  (document.getElementById("settingsDialog") as HTMLDialogElement).close();
  void checkComfyConnection();
  syncCloudKeyUI();
}

export function toggleTargetSecondsInput(): void {
  const mode = (document.getElementById("durationModeSelect") as HTMLSelectElement).value;
  document.getElementById("customSecondsBox")!.style.display = mode === "expand" ? "block" : "none";
}

export function selectSpeed(speedKey: SpeedKey): void {
  computeStore.setSpeed(speedKey);
  document.querySelectorAll<HTMLElement>(".speed-option").forEach((el) => {
    el.classList.toggle("active", el.dataset.speed === speedKey);
  });
  updateLocalRenderEstimateUI();
}

export function updateLocalRenderEstimateUI(): void {
  const estEl = document.getElementById("localEstimatedDurationText");
  if (!estEl) return;
  const currentPlan = storyboardStore.getState().currentPlan;
  const selectedSpeed = computeStore.getState().selectedSpeed;
  const count = document.querySelectorAll("#segmentsContainer .segment-card").length || (currentPlan?.segments?.length || 5);
  const minsPerSeg = selectedSpeed === "balanced" ? 18 : selectedSpeed === "fast" ? 2 : 6;
  const modeName = selectedSpeed === "balanced" ? "標準 20 Steps" : selectedSpeed === "fast" ? "極速預覽" : "LoRA 6 Steps";
  estEl.textContent = `⏱️ 預估總時長（${modeName}）：共 ${count} 段（${count * 5} 秒），約 ${count * minsPerSeg} 分鐘`;
}

function syncModeToolbarUI(isEdu: boolean, isCreative: boolean, gridImageDataUrl: string): void {
  const creativeForm = document.getElementById("step1CreativeForm");
  const eduBox = document.getElementById("step1EduBox");
  if (creativeForm) creativeForm.style.display = isCreative ? "grid" : "none";
  if (eduBox) eduBox.style.display = isEdu ? "block" : "none";

  const paradigm = (document.getElementById("chainParadigmSelect") as HTMLSelectElement | null)?.value || "latent_chain";
  const gridContainer = document.getElementById("gridPreviewContainer");
  if (gridContainer) {
    gridContainer.style.display = isCreative && paradigm === "grid_keyframes" && gridImageDataUrl ? "block" : "none";
  }

  const step2HeaderTitle = document.getElementById("step2HeaderTitleText");
  if (step2HeaderTitle) {
    step2HeaderTitle.textContent = isCreative
      ? (paradigm === "grid_keyframes" ? "步驟二：九宮格與分鏡腳本微調" : "步驟二：分鏡腳本與運鏡微調（潛空間一鏡到底）")
      : "步驟二：教學長片分鏡台（自由秒數 · 語速監控 · 任意段數）";
  }

  const btnBatchGrid = document.getElementById("btnBatchGrid");
  const btnBatchLatent = document.getElementById("btnBatchLatent");
  const btnAddSegment = document.getElementById("btnAddSegment");
  const toolbarTitle = document.getElementById("step2ToolbarTitle");

  if (btnBatchGrid) btnBatchGrid.style.display = isEdu ? "none" : "inline-flex";
  if (btnBatchLatent) {
    btnBatchLatent.textContent = isEdu ? "🔗 批次設為連貫接力" : "🔗 批次設為潛空間";
  }
  if (btnAddSegment) {
    btnAddSegment.textContent = isEdu ? "➕ 新增教學分鏡 (+自適應秒數)" : "➕ 新增一段 (+5秒)";
  }
  if (toolbarTitle) {
    toolbarTitle.textContent = isEdu ? "🎓 教學長片分鏡清單" : "📋 分鏡清單";
  }
}

function syncSegmentCardsModeBadges(isEdu: boolean): void {
  document.querySelectorAll<HTMLElement>(".seg-edu-strip").forEach((el) => {
    el.style.display = isEdu ? "flex" : "none";
  });
  document.querySelectorAll<HTMLElement>(".seg-panel-picker-group").forEach((el) => {
    if (isEdu) el.style.display = "none";
  });

  document.querySelectorAll<HTMLElement>(".seg-chain-mode-select").forEach((el) => {
    const parent = el.closest(".seg-header-controls");
    if (!parent) return;
    const eduBadge = parent.querySelector<HTMLElement>(".seg-edu-mode-badge");
    if (!isEdu) {
      if (el.parentElement) el.parentElement.style.display = "inline-flex";
      if (eduBadge) eduBadge.style.display = "none";
      return;
    }
    if (el.parentElement) el.parentElement.style.display = "none";
    if (eduBadge) {
      eduBadge.style.display = "inline-flex";
      return;
    }
    const span = document.createElement("span");
    span.className = "seg-edu-mode-badge";
    span.style.cssText =
      "font-size:0.8rem; color:#d8b4fe; background:rgba(168,85,247,0.18); border:1px solid rgba(168,85,247,0.35); padding:4px 9px; border-radius:6px;";
    span.textContent = "🎓 教學連貫分鏡";
    parent.insertBefore(span, parent.firstChild);
  });
}

export function selectProjectMode(mode: ProjectMode, autoSwitch = true): void {
  coreStore.setProjectMode(mode);
  const isCreative = mode === "creative";
  const isEdu = mode === "edu";
  const { currentActiveProjectId, isRestoringProject } = coreStore.getState();
  const { gridImageDataUrl } = storyboardStore.getState();

  const cardCreative = document.getElementById("modeCardCreative");
  const cardEdu = document.getElementById("modeCardEdu");
  if (cardCreative) cardCreative.className = `project-mode-card ${isCreative ? "active creative" : ""}`;
  if (cardEdu) cardEdu.className = `project-mode-card ${isEdu ? "active edu" : ""}`;

  const badge = document.getElementById("currentModeBadge");
  if (badge) {
    if (isCreative) {
      badge.textContent = "目前模式：🎬 模式 A：自由提示詞短影片";
      badge.style.borderColor = "#38bdf8";
      badge.style.color = "#7dd3fc";
      badge.style.background = "rgba(56,189,248,0.15)";
    } else {
      badge.textContent = "目前模式：🎓 模式 B：知識文檔轉教學長片";
      badge.style.borderColor = "#a855f7";
      badge.style.color = "#d8b4fe";
      badge.style.background = "rgba(168,85,247,0.15)";
    }
  }

  if (autoSwitch && !isRestoringProject) {
    if (isEdu && currentActiveProjectId !== "fc_tutorial_140s_demo") {
      void loadGoldenTemplate("tutorial_140s");
      return;
    } else if (isCreative && currentActiveProjectId === "fc_tutorial_140s_demo") {
      void loadGoldenTemplate("detective");
      return;
    }
  }

  syncModeToolbarUI(isEdu, isCreative, gridImageDataUrl);
  syncSegmentCardsModeBadges(isEdu);

  updateDurationBadge();
  renderChainTimelineBar();
  updateStep3UI();
}

export function normalizeComputeRoute(route: string): ComputeRoute {
  if (route === "saas_api" || route === "cloud") return "saas_api";
  if (route === "local") return "local";
  return "colab";
}

export function selectRoute(route: string): void {
  const normalized = normalizeComputeRoute(route);
  computeStore.setRoute(normalized);

  const isColab = normalized === "colab";
  const isCloud = normalized === "saas_api";
  const isLocal = normalized === "local";

  const cardColab = document.getElementById("routeCardColab");
  const cardCloud = document.getElementById("routeCardCloud");
  const cardLocal = document.getElementById("routeCardLocal");

  if (cardColab) cardColab.className = `route-tab-card ${isColab ? "active colab" : ""}`;
  if (cardCloud) cardCloud.className = `route-tab-card ${isCloud ? "active cloud" : ""}`;
  if (cardLocal) cardLocal.className = `route-tab-card ${isLocal ? "active local" : ""}`;

  const badge = document.getElementById("currentRouteBadge");
  if (badge) {
    if (isColab) {
      badge.textContent = "目前路線：☁️ Google Colab (Gemini Pro Agent)";
      badge.className = "badge ok";
      badge.style.borderColor = "#38bdf8";
      badge.style.color = "#7dd3fc";
      badge.style.background = "rgba(56,189,248,0.15)";
    } else if (isCloud) {
      badge.textContent = "目前路線：⚡ 商業雲端 API (saas_api: Seedance / fal.ai)";
      badge.className = "badge warn";
      badge.style.borderColor = "#10b981";
      badge.style.color = "#6ee7b7";
      badge.style.background = "rgba(16,185,129,0.15)";
    } else {
      badge.textContent = "目前路線：🖥️ 本機 Metal / ComfyUI";
      badge.className = "badge ok";
      badge.style.borderColor = "#f59e0b";
      badge.style.color = "#fcd34d";
      badge.style.background = "rgba(245,158,11,0.15)";
    }
  }

  if (isLocal && window.H3LocalEnv && typeof window.H3LocalEnv.pingAttention === "function") {
    window.H3LocalEnv.pingAttention();
  }

  updateStep3UI();
}

export function updateStep3UI(): void {
  const activeRoute = computeStore.getState().activeRoute;
  const activeProjectMode = coreStore.getState().activeProjectMode;
  const isColab = activeRoute === "colab";
  const isCloud = activeRoute === "saas_api";
  const isLocal = activeRoute === "local";
  const isEdu = activeProjectMode === "edu";

  const panelColab = document.getElementById("panelColabView");
  const panelCloud = document.getElementById("panelCloudView");
  const panelLocal = document.getElementById("panelLocalView");
  const panelEdu = document.getElementById("panelEduView");

  if (panelColab) panelColab.style.display = isColab ? "block" : "none";
  if (panelCloud) panelCloud.style.display = isCloud ? "block" : "none";
  if (panelLocal) panelLocal.style.display = isLocal && !isEdu ? "block" : "none";
  if (panelEdu) panelEdu.style.display = isLocal && isEdu ? "block" : "none";

  const step3Title = document.getElementById("step3TitleText");
  const step3Tag = document.getElementById("step3RouteTag");

  if (!step3Title || !step3Tag) return;

  if (isColab) {
    step3Title.textContent = isEdu
      ? "步驟三：Google Colab (Gemini Pro Agent) 教學長片任務包導出與執行"
      : "步驟三：Google Colab (Gemini Pro Agent) 任務包導出與執行";
    step3Tag.textContent = "Colab Agent 模式";
    step3Tag.className = "badge ok";
    step3Tag.style.borderColor = "#38bdf8";
    step3Tag.style.color = "#7dd3fc";
    renderColabPipelineTracker();
  } else if (isCloud) {
    step3Title.textContent = isEdu
      ? "步驟三：商業雲端 API 教學長片並行 / 接力渲染"
      : "步驟三：商業雲端 API 並行 / 接力渲染";
    step3Tag.textContent = "雲端 API 模式";
    step3Tag.className = "badge ok";
    step3Tag.style.borderColor = "#10b981";
    step3Tag.style.color = "#6ee7b7";
    syncCloudKeyUI();
    updateCloudCostEstimate();
  } else {
    if (isEdu) {
      step3Title.textContent = "步驟三：本地 H3.c 原生管線教學長片導出與執行";
      step3Tag.textContent = "本機 H3.c 原生模式";
      step3Tag.className = "badge ok";
      step3Tag.style.borderColor = "#a855f7";
      step3Tag.style.color = "#d8b4fe";
    } else {
      step3Title.textContent = "步驟三：本地 Metal / ComfyUI 管線示範與對齊";
      step3Tag.textContent = "本機示範模式";
      step3Tag.className = "badge ok";
      step3Tag.style.borderColor = "#f59e0b";
      step3Tag.style.color = "#fcd34d";
    }
  }

  refreshAllSegmentCardModeUI();
  updateColabPromptText();
  updateAgentQuickStartPromptUI();
}

export function updateAgentQuickStartPromptUI(): void {
  const ta = document.getElementById("agentQuickStartTextarea") as HTMLTextAreaElement | null;
  if (!ta) return;
  const trackType = (document.getElementById("agentQuickTrackSelect") as HTMLSelectElement | null)?.value || "production";
  const userBrief = (document.getElementById("agentQuickBriefInput") as HTMLInputElement | null)?.value || "";
  const activeProjectMode = coreStore.getState().activeProjectMode;
  const activeRoute = computeStore.getState().activeRoute;
  if (window.H3Prompts && typeof window.H3Prompts.buildAgentQuickStartPrompt === "function") {
    ta.value = window.H3Prompts.buildAgentQuickStartPrompt({
      projectMode: activeProjectMode === "edu" ? "edu" : "creative",
      route: activeRoute || "colab",
      trackType,
      userBrief,
    });
  }
}

export function selectStartWorkflowMode(mode: string): void {
  const normalized = mode === "agent" ? "agent" : "web";
  coreStore.setStartWorkflowMode(normalized);
  const isAgent = normalized === "agent";
  const cardWeb = document.getElementById("startModeCardWeb");
  const cardAgent = document.getElementById("startModeCardAgent");
  const panel = document.getElementById("agentQuickStartPanel");
  const badge = document.getElementById("currentStartModeBadge");
  if (cardWeb) cardWeb.className = `project-mode-card ${!isAgent ? "active creative" : ""}`;
  if (cardAgent) cardAgent.className = `project-mode-card ${isAgent ? "active edu" : ""}`;
  if (panel) panel.style.display = isAgent ? "block" : "none";
  if (badge) {
    badge.textContent = isAgent
      ? "目前方式：🤖 交給 AI Agent 協助 (Agent-First)"
      : "目前方式：🧭 使用網頁逐步操作 (Web-First)";
  }
  updateAgentQuickStartPromptUI();
}

export function copyAgentQuickStartPrompt(): void {
  updateAgentQuickStartPromptUI();
  const ta = document.getElementById("agentQuickStartTextarea") as HTMLTextAreaElement | null;
  if (!ta) return;
  const btn = document.getElementById("copyAgentQuickStartBtn");
  const done = () => {
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = "✅ 已複製快速啟動指令！";
      setTimeout(() => {
        btn.textContent = orig;
      }, 2500);
    }
    showToast("📋 已複製 Agent-First 快速啟動指令！直接貼給 Agent 即可對話開始。");
  };
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(ta.value).then(done).catch(() => fallbackCopyText(ta, done));
  } else {
    fallbackCopyText(ta, done);
  }
}

export function copyEduAgentDocPrompt(): void {
  const prompt =
    (window.H3Prompts && window.H3Prompts.EDU_AGENT_DOC_PROMPT) ||
    `你現在是 H3 Storyboard Studio 的「長篇教學文檔架構解析專家」。
請【先不要直接執行解析】，請先精確回覆我以下這句話：
「收到！請在下一句提供你要解析的文件路徑（例如 docs/report.pdf 或 paper.md），或者直接把文檔文字貼給我。收到後我將立即為你進行無遺漏的章節與核心公式拆解，並輸出結構化 Markdown！」

當我在下一句提供文檔路徑或內容後，你才正式執行以下任務：
1. 完整閱讀文檔，依照原始脈絡劃分所有章節標題（#、##）。
2. 保留所有關鍵論點、核心公式（LaTeX/文字）與專業術語，嚴禁偷工減料或跳過段落。
3. 輸出乾淨完整的 Markdown 格式，並提示我將其貼回 Doc-to-Edu 介面以自動產生各分鏡卡片。`;
  copyTextToClipboard(prompt, "📋 已複製 Agent 兩階段解讀 Prompt！直接貼給你的 Claude Code / Antigravity / Cursor");
}

export function copyMineruAgentSetupPrompt(): void {
  const prompt =
    (window.H3Prompts && window.H3Prompts.MINERU_AGENT_SETUP_PROMPT) ||
    `請幫我檢查並配置本地 MinerU (magic-pdf) 深度文檔解析環境：
1. 探測當前作業系統（macOS / Linux / Windows）。
2. 檢查系統依賴工具：
   - 若為 macOS：檢查是否已安裝 Homebrew (command -v brew)。若未安裝，請先提示我執行 Homebrew 官方安裝指令 (/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)")；若已安裝，檢查並安裝 poppler 與 libreoffice (brew install poppler libreoffice)。
   - 若為 Linux (Ubuntu/Debian)：執行 sudo apt-get update && sudo apt-get install -y poppler-utils libreoffice。
3. 檢查 Python 3 環境並安裝 MinerU 核心套件：python3 -m pip install -U "magic-pdf[full]"。
4. 執行 magic-pdf --version 驗證安裝狀態，並回報環境已就緒。`;
  copyTextToClipboard(prompt, "📋 已複製交由 Agent 探測與配置 MinerU 的 Prompt！");
}

export function copyMineruLocalCmd(): void {
  const cmd = `# 1. 檢測作業系統與套件管理器\nOS_TYPE="$(uname -s)"\necho "檢測到作業系統: $OS_TYPE"\n\nif [ "$OS_TYPE" = "Darwin" ]; then\n  if ! command -v brew >/dev/null 2>&1; then\n    echo "⚠️ 未檢測到 Homebrew！請先執行以下指令安裝 Homebrew："\n    echo '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'\n    exit 1\n  fi\n  echo "✅ 檢測到 Homebrew，正在安裝系統依賴 poppler 與 libreoffice..."\n  brew install poppler libreoffice\nelif [ "$OS_TYPE" = "Linux" ]; then\n  if command -v apt-get >/dev/null 2>&1; then\n    echo "✅ 檢測到 apt-get，正在安裝系統依賴..."\n    sudo apt-get update && sudo apt-get install -y poppler-utils libreoffice\n  else\n    echo "請使用系統套件管理器安裝 poppler 與 libreoffice"\n  fi\nfi\n\n# 2. 升級 pip 並安裝 MinerU 核心套件\npython3 -m pip install --upgrade pip\npython3 -m pip install -U "magic-pdf[full]"\n\n# 3. 驗證安裝\nmagic-pdf --version && echo "🎉 MinerU 環境配置完成！執行 magic-pdf -p <your_file.pdf> -o ./output 即可解析。"`;
  copyTextToClipboard(cmd, "📋 已複製具備前置檢查的 MinerU 本機安裝腳本！");
}

export function copyMineruColabCmd(): void {
  const cmd = `# Colab 雲端免本機安裝環境配置\n!apt-get update -qq && !apt-get install -y -qq poppler-utils libreoffice\n!python3 -m pip install -q -U "magic-pdf[full]"\n!magic-pdf --version\n# 執行解析 (請先在 Colab 左側檔案欄上傳 sample.pdf)\n!magic-pdf -p sample.pdf -o ./output`;
  copyTextToClipboard(cmd, "📋 已複製 MinerU Colab 雲端安裝與執行代碼！");
}

export function openShareModal(): void {
  const sid = getOrCreateSessionId();
  const shareUrl = `${window.location.origin}${window.location.pathname}#session=${sid}`;
  (document.getElementById("shareUrlInput") as HTMLInputElement).value = shareUrl;
  document.getElementById("shareSessionLabel")!.textContent = `ID: ${sid}`;
  const qrImg = document.getElementById("shareQrImg") as HTMLImageElement;
  qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(shareUrl)}`;
  (document.getElementById("shareDialog") as HTMLDialogElement).showModal();
}

export function copyShareUrl(): void {
  const input = document.getElementById("shareUrlInput") as HTMLInputElement;
  input.select();
  copyTextToClipboard(input.value, "📋 已複製跨裝置監看網址！");
}
