import type { SpeedKey } from "../types/studio.ts";
import { TIMING_CONSTANTS } from "../config/constants.ts";
import { getErrorMessage } from "../utils/errors.ts";
import { DEMO_PROJECT_CONFIG, createGoldenProjectObject } from "../data/templates.ts";
import { audioSubtitleStore } from "../stores/audioSubtitleStore.ts";
import { computeStore } from "../stores/computeStore.ts";
import { coreStore } from "../stores/coreStore.ts";
import { storyboardStore } from "../stores/storyboardStore.ts";
import { copyTextToClipboard, escapeHtml, selectProjectMode, selectRoute, selectSpeed, showToast } from "./uiShell.ts";
import { loadGoldenTemplate, renderSlicedPanelsBar, showGridPreview } from "./director.ts";
import { renderPlanUI, syncSegmentsFromDOM } from "./storyboardEditor.ts";
import { playVideoInStage, renderSegmentsPlaylist } from "./stagePlayer.ts";
import { downloadSubtitleFile, syncDialogueItemsFromPlan, updateBgmVolume } from "./audioSubtitles.ts";

export function createDefaultDemoProjectObject(): Record<string, any> {
  return createGoldenProjectObject("detective");
}

export const createShisaDemoProjectObject = createDefaultDemoProjectObject;

export function captureCurrentProjectState(): Record<string, any> {
  const segs = syncSegmentsFromDOM();
  const storyboard = storyboardStore.getState();
  const core = coreStore.getState();
  const compute = computeStore.getState();
  const audio = audioSubtitleStore.getState();

  const currentPlan = storyboard.currentPlan;
  const refImg = document.getElementById("refPreview") as HTMLImageElement | null;
  const nameInput = document.getElementById("currentProjectNameInput") as HTMLInputElement | null;
  let activeProjectName = core.currentActiveProjectName;
  if (nameInput && nameInput.value.trim()) {
    activeProjectName = nameInput.value.trim();
    coreStore.patchCore({ currentActiveProjectName: activeProjectName });
  }

  return {
    id: core.currentActiveProjectId || "fc_detective_25s_demo",
    name: activeProjectName || "未命名分鏡專案",
    updatedAt: Date.now(),
    chineseDesc: (document.getElementById("chineseDesc") as HTMLTextAreaElement | null)?.value || "",
    speedMode: compute.selectedSpeed || "quality",
    activeRoute: compute.activeRoute || "colab",
    refImageDataUrl: refImg && refImg.style.display !== "none" && refImg.getAttribute("src") ? refImg.getAttribute("src") : "",
    refImageMime: storyboard.refImageMime || "image/jpeg",
    gridImageDataUrl: storyboard.gridImageDataUrl || "",
    slicedPanelsDataUrls: { ...storyboard.slicedPanelsDataUrls },
    plan: currentPlan ? JSON.parse(JSON.stringify(currentPlan)) : { project_slug: "story", recommended_total_seconds: 15, segments: segs },
    playlist: JSON.parse(JSON.stringify(compute.currentPlaylist || [])),
    mergedVideoUrl: document.getElementById("mainVideoPlayer")?.getAttribute("src") || "",
    segmentHistory: JSON.parse(JSON.stringify(compute.segmentHistory || {})),
    activeVersionIndex: JSON.parse(JSON.stringify(compute.activeVersionIndex || {})),
    dialogueItems: JSON.parse(JSON.stringify(audio.currentDialogueItems || [])),
    bgmStyle: (document.getElementById("bgmStyleSelect") as HTMLSelectElement | null)?.value || "fantasy",
    bgmVolume: parseInt((document.getElementById("bgmVolumeSlider") as HTMLInputElement | null)?.value || "35", 10) || 35,
    audioDucking: (document.getElementById("audioDuckingCheck") as HTMLInputElement | null)?.checked ?? true,
    softSubtitle: (document.getElementById("enableSoftSubtitleCheck") as HTMLInputElement | null)?.checked ?? true,
    burnInSubtitle: (document.getElementById("burnInSubtitleCheck") as HTMLInputElement | null)?.checked ?? false,
  };
}

export async function applyProjectStateToUI(proj: Record<string, any> | null | undefined): Promise<void> {
  if (!proj) return;
  coreStore.setRestoringProject(true);
  try {
    const projectId = proj.id || "fc_detective_25s_demo";
    const projectName = proj.name || "未命名分鏡專案";
    coreStore.setActiveProject(projectId, projectName);

    const nameInput = document.getElementById("currentProjectNameInput") as HTMLInputElement | null;
    if (nameInput) nameInput.value = projectName;

    const projMode =
      proj.activeProjectMode ||
      (proj.id === "fc_handwashing_edu_demo" || proj.id === "fc_tutorial_140s_demo" || proj.plan?.project_mode === "edu_explainer"
        ? "edu"
        : "creative");
    selectProjectMode(projMode, false);

    const refImg = document.getElementById("refPreview") as HTMLImageElement | null;
    const icon = document.getElementById("refPlaceholderIcon");
    const btnText = document.getElementById("refUploadBtnText");
    if (proj.refImageDataUrl) {
      if (refImg) {
        refImg.src = proj.refImageDataUrl;
        refImg.style.display = "block";
      }
      if (String(proj.refImageDataUrl).startsWith("data:")) {
        storyboardStore.setRefImage(String(proj.refImageDataUrl).split(",")[1] || "", proj.refImageMime || "image/jpeg");
      } else if (proj.refImageMime) {
        storyboardStore.patchStoryboard({ refImageMime: proj.refImageMime });
      }
      if (icon) icon.style.display = "none";
      if (btnText) btnText.textContent = "📷 載入圖片 (更換)";
    } else {
      if (refImg) {
        refImg.removeAttribute("src");
        refImg.style.display = "none";
      }
      storyboardStore.setRefImage("", proj.refImageMime || "image/jpeg");
      if (icon) icon.style.display = "block";
      if (btnText) btnText.textContent = "📷 載入圖片";
    }

    if (proj.gridImageDataUrl) {
      showGridPreview(proj.gridImageDataUrl);
      if (proj.slicedPanelsDataUrls && Object.keys(proj.slicedPanelsDataUrls).length === 9) {
        storyboardStore.setSlicedPanels({ ...proj.slicedPanelsDataUrls });
        renderSlicedPanelsBar();
      }
    } else {
      storyboardStore.patchStoryboard({ gridImageDataUrl: "", slicedPanelsDataUrls: {} });
      const box = document.getElementById("gridPreviewContainer");
      if (box) box.style.display = "none";
      const bar = document.getElementById("slicedPanelsContainer");
      if (bar) bar.innerHTML = "";
    }

    const descEl = document.getElementById("chineseDesc") as HTMLTextAreaElement | null;
    if (descEl) descEl.value = proj.chineseDesc || "";
    selectSpeed((proj.speedMode || "quality") as SpeedKey);
    if (proj.activeRoute) selectRoute(proj.activeRoute);

    computeStore.patchCompute({
      segmentHistory: proj.segmentHistory ? JSON.parse(JSON.stringify(proj.segmentHistory)) : {},
      activeVersionIndex: proj.activeVersionIndex ? JSON.parse(JSON.stringify(proj.activeVersionIndex)) : {},
    });

    if (proj.plan) {
      renderPlanUI(JSON.parse(JSON.stringify(proj.plan)));
    }

    if (Array.isArray(proj.dialogueItems) && proj.dialogueItems.length > 0) {
      audioSubtitleStore.setDialogueItems(JSON.parse(JSON.stringify(proj.dialogueItems)));
    }
    syncDialogueItemsFromPlan();
    const bgmSelect = document.getElementById("bgmStyleSelect") as HTMLSelectElement | null;
    if (bgmSelect && proj.bgmStyle) bgmSelect.value = proj.bgmStyle;
    const bgmSlider = document.getElementById("bgmVolumeSlider") as HTMLInputElement | null;
    if (bgmSlider && typeof proj.bgmVolume === "number") {
      bgmSlider.value = String(proj.bgmVolume);
      updateBgmVolume(proj.bgmVolume);
    }

    if (Array.isArray(proj.playlist) && proj.playlist.length > 0) {
      renderSegmentsPlaylist(proj.playlist);
    } else {
      computeStore.setPlaylist([]);
      const box = document.getElementById("cloudSegmentsPlaylistBox");
      if (box) box.style.display = "none";
    }

    if (proj.mergedVideoUrl) {
      playVideoInStage(proj.mergedVideoUrl, `🎬 ${projectName}`, false);
    } else {
      const player = document.getElementById("mainVideoPlayer");
      if (player) player.removeAttribute("src");
      const lbl = document.getElementById("currentVideoLabel");
      if (lbl) lbl.textContent = "尚未載入影片";
      const dl = document.getElementById("downloadVideoBtn");
      if (dl) dl.style.display = "none";
    }

    await refreshProjectSwitcherDropdown();
    updateWorkspaceOnboardingBanner(proj);
  } finally {
    coreStore.setRestoringProject(false);
  }
}

export function updateWorkspaceOnboardingBanner(proj: Record<string, any> | null | undefined): void {
  const textEl = document.getElementById("workspaceOnboardingText");
  const clearBtn = document.getElementById("onboardingClearBtn");
  const demoBtn = document.getElementById("onboardingLoadDemoBtn");
  if (!textEl) return;
  const segLen = proj?.plan?.segments?.length || 0;
  const isDemo = Boolean(proj?.isDemo || String(proj?.id || "").endsWith("_demo"));
  if (segLen === 0) {
    textEl.innerHTML =
      "✨ <strong>目前為空白創作模式</strong>：請於下方選擇「創意短片」或「教學長片」，輸入主題／文檔並建立自己的分鏡！（想先看效果可點右側載入範例）";
    if (clearBtn) clearBtn.style.display = "none";
    if (demoBtn) demoBtn.style.display = "inline-flex";
  } else if (isDemo) {
    textEl.innerHTML =
      "👀 <strong>目前正在瀏覽官方實測範例</strong>：您可以自由試聽／預覽各步驟，準備好製作自己的影片時，點右側【✨ 清空開始我的創作】即可從零開始！";
    if (clearBtn) clearBtn.style.display = "inline-flex";
    if (demoBtn) demoBtn.style.display = "none";
  } else {
    textEl.innerHTML = `🎬 <strong>正在編輯自有專案</strong>（共 ${segLen} 段分鏡）：修改會自動儲存於瀏覽器，也可隨時匯出給 Agent 或重置為空白。`;
    if (clearBtn) clearBtn.style.display = "inline-flex";
    if (demoBtn) demoBtn.style.display = "inline-flex";
  }
}

export async function refreshProjectSwitcherDropdown(): Promise<void> {
  if (typeof window.H3ProjectStore === "undefined") return;
  const select = document.getElementById("projectSwitcherSelect") as HTMLSelectElement | null;
  if (!select) return;

  const currentActiveProjectId = coreStore.getState().currentActiveProjectId;
  const list = await window.H3ProjectStore.listProjects();
  select.innerHTML = list
    .map((p: any) => {
      const dateStr = new Date(p.updatedAt || Date.now()).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
      const segs = p.plan?.segments || [];
      const segCount = segs.length;
      let durationLabel = "空白專案";
      if (segCount > 0) {
        const isEdu =
          p.activeProjectMode === "edu" ||
          p.plan?.project_mode === "edu_explainer" ||
          segs.some((s: any) => Number(s.frames) > 0 && Number(s.frames) !== 124);
        let running = 0;
        if (typeof window.H3TimecodeHelper !== "undefined" && typeof window.H3TimecodeHelper.resolveSegmentTiming === "function") {
          segs.forEach((seg: any) => {
            running = window.H3TimecodeHelper!.resolveSegmentTiming(seg, running, isEdu).endSec;
          });
        } else {
          running = segCount * 5;
        }
        durationLabel = `${Math.max(5, Math.round(running))}s`;
      }
      const selected = p.id === currentActiveProjectId ? "selected" : "";
      return `<option value="${escapeHtml(p.id)}" ${selected}>${escapeHtml(p.name)} (${durationLabel} · ${dateStr})</option>`;
    })
    .join("");
}

export function scheduleAutoSave(): void {
  if (coreStore.getState().isRestoringProject || typeof window.H3ProjectStore === "undefined") return;
  const badge = document.getElementById("autoSaveStatusBadge");
  if (badge) {
    badge.textContent = "⏳ 儲存中...";
    badge.style.borderColor = "#f59e0b";
    badge.style.color = "#fcd34d";
  }
  const prevTimer = coreStore.getState().autoSaveTimer;
  if (prevTimer) clearTimeout(prevTimer);
  const timer = setTimeout(async () => {
    try {
      const state = captureCurrentProjectState();
      await window.H3ProjectStore!.saveProject(state);
      await refreshProjectSwitcherDropdown();
      const nowStr = new Date().toLocaleTimeString("zh-TW", { hour12: false });
      if (badge) {
        badge.textContent = `💾 已自動存檔 (${nowStr})`;
        badge.style.borderColor = "#10b981";
        badge.style.color = "#6ee7b7";
      }
    } catch (err) {
      console.warn("自動存檔失敗:", err);
    }
  }, TIMING_CONSTANTS.AUTO_SAVE_DEBOUNCE_MS);
  coreStore.setAutoSaveTimer(timer);
}

export async function switchActiveProject(projectId: string): Promise<void> {
  if (!projectId || typeof window.H3ProjectStore === "undefined") return;
  await window.H3ProjectStore.saveProject(captureCurrentProjectState());
  const target = await window.H3ProjectStore.getProject(projectId);
  if (target) {
    await window.H3ProjectStore.setLastActiveProjectId(target.id);
    await applyProjectStateToUI(target);
    showToast(`📂 已切換至專案：「${target.name}」`);
  }
}

export function renameCurrentProject(newName: string): void {
  const trimmed = (newName || "").trim();
  if (!trimmed) return;
  coreStore.patchCore({ currentActiveProjectName: trimmed });
  scheduleAutoSave();
  showToast(`✏️ 專案已重新命名為：「${trimmed}」`);
}

export function promptRenameCurrentProject(): void {
  const selectEl = document.getElementById("projectSwitcherSelect") as HTMLSelectElement | null;
  const currentName =
    coreStore.getState().currentActiveProjectName ||
    (selectEl && selectEl.selectedOptions[0] ? selectEl.selectedOptions[0].textContent || "" : "");
  const newName = window.prompt("請輸入新的專案名稱：", currentName);
  if (newName !== null && newName.trim()) {
    renameCurrentProject(newName.trim());
    const nameInput = document.getElementById("currentProjectNameInput") as HTMLInputElement | null;
    if (nameInput) nameInput.value = newName.trim();
    if (selectEl && selectEl.selectedOptions[0]) {
      selectEl.selectedOptions[0].textContent = newName.trim();
    }
  }
}

export async function createNewBlankProject(): Promise<void> {
  if (typeof window.H3ProjectStore === "undefined") return;
  await window.H3ProjectStore.saveProject(captureCurrentProjectState());
  const list = await window.H3ProjectStore.listProjects();
  const newProj = window.H3ProjectStore.createEmptyProject({
    name: `我的創作專案 #${list.length + 1}`,
  });
  newProj.plan.segments = [];
  newProj.plan.recommended_total_seconds = 0;
  newProj.plan.reasoning_zh = "空白創作專案：請於步驟一輸入故事大綱或貼上教學文檔後產生分鏡。";
  const eduInput = document.getElementById("eduDocInput") as HTMLTextAreaElement | null;
  if (eduInput) eduInput.value = "";
  await window.H3ProjectStore.saveProject(newProj);
  await window.H3ProjectStore.setLastActiveProjectId(newProj.id);
  await applyProjectStateToUI(newProj);
  document.getElementById("step1Card")?.scrollIntoView({ behavior: "smooth" });
  showToast(`✨ 已清空並建立空白專案：「${newProj.name}」，請於步驟一開始創作！`);
}

export async function resetToDefaultDemoProject(): Promise<void> {
  await loadGoldenTemplate("detective");
}

export const resetToShisaDemoProject = resetToDefaultDemoProject;

export async function deleteCurrentActiveProject(): Promise<void> {
  if (typeof window.H3ProjectStore === "undefined") return;
  const list = await window.H3ProjectStore.listProjects();
  if (list.length <= 1) {
    showToast("⚠️ 這是最後一個專案，無法刪除！您可直接點擊「➕ 新增空白專案」或修改內容。");
    return;
  }
  const { currentActiveProjectId, currentActiveProjectName } = coreStore.getState();
  if (!confirm(`確定要刪除專案「${currentActiveProjectName}」嗎？此動作無法復原。`)) {
    return;
  }
  await window.H3ProjectStore.deleteProject(currentActiveProjectId);
  const remaining = await window.H3ProjectStore.listProjects();
  const nextProj = remaining[0] || createShisaDemoProjectObject();
  await window.H3ProjectStore.setLastActiveProjectId(nextProj.id);
  await applyProjectStateToUI(nextProj);
  showToast("🗑️ 已刪除專案");
}

export function exportCurrentProjectFile(): void {
  if (typeof window.H3ProjectStore === "undefined") return;
  try {
    const state = captureCurrentProjectState();
    const jsonStr = window.H3ProjectStore.serializeProjectBundle(state);
    const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8" });
    const slug = (state.plan?.project_slug || state.name || "project").replace(/[^a-zA-Z0-9_\u4e00-\u9fa5-]/g, "_");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${slug}.filmchain.json`;
    a.click();
    showToast(`📤 已匯出完整專案檔：${slug}.filmchain.json`);
  } catch (err: unknown) {
    showToast(`❌ 匯出失敗：${getErrorMessage(err)}`);
  }
}

export async function handleImportProjectFile(input: HTMLInputElement): Promise<void> {
  if (!input.files || !input.files[0] || typeof window.H3ProjectStore === "undefined") return;
  const file = input.files[0];
  try {
    const text = await file.text();
    const restored = window.H3ProjectStore.parseAndValidateBundle(text);
    await window.H3ProjectStore.saveProject(restored);
    await applyProjectStateToUI(restored);
    showToast(`📥 成功匯入並還原專案：「${restored.name}」`);
  } catch (err: unknown) {
    showToast(`❌ 匯入專案失敗：${getErrorMessage(err)}`);
  } finally {
    input.value = "";
  }
}

export function exportAllMediaAssets(): void {
  const { gridImageDataUrl, currentPlan } = storyboardStore.getState();
  const { currentDialogueItems } = audioSubtitleStore.getState();
  let count = 0;
  if (gridImageDataUrl) {
    const a = document.createElement("a");
    a.href = gridImageDataUrl;
    a.download = `${currentPlan?.project_slug || "storyboard"}_9grid.png`;
    a.click();
    count++;
  }
  const mainVideo = document.getElementById("mainVideoPlayer")?.getAttribute("src");
  if (mainVideo) {
    setTimeout(() => {
      const a = document.createElement("a");
      a.href = mainVideo;
      a.download = `${currentPlan?.project_slug || "storyboard"}_merged.mp4`;
      a.click();
    }, 350);
    count++;
  }
  if (currentDialogueItems && currentDialogueItems.some((d) => d.text && d.text.trim())) {
    setTimeout(() => downloadSubtitleFile("srt"), 700);
    count++;
  }
  if (count > 0) {
    showToast(`📦 正在為您下載 ${count} 項專案產出素材...`);
  } else {
    showToast("⚠️ 目前尚無可下載的九宮格或影片素材！");
  }
}

export async function shareProjectToCloud(): Promise<void> {
  if (typeof window.H3ProjectStore === "undefined") return;
  try {
    showToast("☁️ 正在加密打包並上傳跨裝置雲端快照...");
    const state = captureCurrentProjectState();
    await window.H3ProjectStore.saveProject(state);
    const res = await window.H3ProjectStore.syncProjectToCloud(state);
    const dialog = document.getElementById("cloudShareDialog") as HTMLDialogElement | null;
    const input = document.getElementById("cloudShareUrlInput") as HTMLInputElement | null;
    if (input) input.value = res.shareUrl;
    if (dialog) dialog.showModal();
    showToast("✅ 跨裝置雲端接力連結已生成！");
  } catch (err: unknown) {
    showToast(`❌ 雲端同步失敗：${getErrorMessage(err)}`);
  }
}

export function copyCloudShareUrl(): void {
  const input = document.getElementById("cloudShareUrlInput") as HTMLInputElement | null;
  if (!input || !input.value) return;
  copyTextToClipboard(input.value, "📋 已複製跨裝置連結！可在手機或另一台電腦直接貼上開啟");
}

export async function initWorkspaceOnLoad(): Promise<void> {
  if (typeof window.H3ProjectStore === "undefined") {
    loadShisaDemo();
    return;
  }

  try {
    const urlParams = new URLSearchParams(window.location.search);
    const cloudProjectId = urlParams.get("project");
    if (cloudProjectId) {
      showToast("☁️ 正在從雲端載入跨裝置專案快照...");
      const cloudProj = await window.H3ProjectStore.fetchProjectFromCloud(cloudProjectId);
      await window.H3ProjectStore.saveProject(cloudProj);
      await applyProjectStateToUI(cloudProj);
      showToast(`🎉 已載入雲端接力專案：「${cloudProj.name}」`);
      return;
    }

    const isLegacyProject = (p: any): boolean =>
      !p ||
      p.id === "fc_shisa_demo" ||
      p.id === "fc_handwashing_edu_demo" ||
      (p.name && (p.name.includes("風獅爺") || p.name.includes("洗手"))) ||
      (p.refImageDataUrl && (p.refImageDataUrl.includes("shisa") || p.refImageDataUrl.includes("handwashing"))) ||
      (p.chineseDesc && (p.chineseDesc.includes("風獅爺") || p.chineseDesc.includes("洗手")));

    const allProjects = await window.H3ProjectStore.listProjects();
    for (const p of allProjects) {
      if (isLegacyProject(p)) {
        await window.H3ProjectStore.deleteProject(p.id);
      }
    }

    const goldenKeys = ["detective", "ink_sorcerer", "tutorial_140s"];
    for (const key of goldenKeys) {
      const tplObj = createGoldenProjectObject(key);
      const existing = await window.H3ProjectStore.getProject(tplObj.id);
      if (!existing) {
        await window.H3ProjectStore.saveProject(tplObj);
      } else if (existing.isDemo && existing.name !== tplObj.name) {
        existing.name = tplObj.name;
        await window.H3ProjectStore.saveProject(existing);
      }
    }

    const lastId = await window.H3ProjectStore.getLastActiveProjectId();
    if (lastId) {
      const savedProj = await window.H3ProjectStore.getProject(lastId);
      if (savedProj && !isLegacyProject(savedProj)) {
        await applyProjectStateToUI(savedProj);
        return;
      }
    }

    const defaultProj = (await window.H3ProjectStore.getProject("fc_tutorial_140s_demo")) || createGoldenProjectObject("tutorial_140s");
    await window.H3ProjectStore.setLastActiveProjectId(defaultProj.id);
    await applyProjectStateToUI(defaultProj);
  } catch (err) {
    console.warn("工作區初始化回退至預設範例:", err);
    loadDefaultDemo();
  }
}

export function loadDefaultDemo(): void {
  const refImg = document.getElementById("refPreview") as HTMLImageElement | null;
  if (refImg) {
    refImg.src = DEMO_PROJECT_CONFIG.ref_image_path;
    refImg.style.display = "block";
  }
  const icon = document.getElementById("refPlaceholderIcon");
  if (icon) icon.style.display = "none";
  const btnText = document.getElementById("refUploadBtnText");
  if (btnText) btnText.textContent = "📷 載入圖片 (更換)";

  showGridPreview(DEMO_PROJECT_CONFIG.grid_image_path);

  const descEl = document.getElementById("chineseDesc") as HTMLTextAreaElement | null;
  if (descEl) descEl.value = DEMO_PROJECT_CONFIG.chinese_desc;
  selectSpeed("quality");
  renderPlanUI(JSON.parse(JSON.stringify(DEMO_PROJECT_CONFIG.plan)));

  renderSegmentsPlaylist(DEMO_PROJECT_CONFIG.part_videos);
  playVideoInStage(DEMO_PROJECT_CONFIG.merged_video_path, "🎬 預設示範 25.7 秒完整合併成果", false);
}

export const loadShisaDemo = loadDefaultDemo;
