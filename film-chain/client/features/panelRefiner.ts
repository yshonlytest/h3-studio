import { formatDiagnosticError, getErrorMessage } from "../utils/errors.ts";
import { storyboardStore } from "../stores/storyboardStore.ts";
import { getPrefs, openSettingsModal, showToast } from "./uiShell.ts";
import {
  dataUrlToBlob,
  fileToDataUrl,
  generateGridViaNanoBanana,
  generateGridViaOpenAI,
  renderSlicedPanelsBar,
} from "./director.ts";
import { scheduleAutoSave } from "./workspaceManager.ts";

export function openSinglePanelRefinerModal(panelIdx: number): void {
  storyboardStore.setEditingPanelIndex(panelIdx);
  const dialog = document.getElementById("singlePanelRefineDialog") as HTMLDialogElement | null;
  const title = document.getElementById("singlePanelRefineTitle");
  const previewImg = document.getElementById("singlePanelRefinePreviewImg") as HTMLImageElement | null;
  const promptInput = document.getElementById("singlePanelPromptInput") as HTMLTextAreaElement | null;
  const statusEl = document.getElementById("singlePanelRefineStatus");

  const { slicedPanelsDataUrls, currentPlan } = storyboardStore.getState();
  if (title) title.textContent = `✨ 九宮格單格局部精修 (Panel #${panelIdx})`;
  if (previewImg) previewImg.src = slicedPanelsDataUrls[panelIdx] || "";
  if (statusEl) statusEl.style.display = "none";

  let segHint = "";
  if (currentPlan && Array.isArray(currentPlan.segments)) {
    const matchSeg = currentPlan.segments.find((s) => (s.end_panel || 3) >= panelIdx) || currentPlan.segments[0];
    if (matchSeg && matchSeg.title) segHint = matchSeg.title;
  }
  if (promptInput) {
    promptInput.value = "";
    promptInput.placeholder = `例如：修正 Panel ${panelIdx} 的表情與動作（對應段落：${segHint || "無"}）...`;
  }
  if (dialog) dialog.showModal();
}

export function triggerSinglePanelUpload(panelIdx?: number): void {
  if (panelIdx) {
    storyboardStore.setEditingPanelIndex(panelIdx);
  }
  const fileInput = document.getElementById("singlePanelFileInput") as HTMLInputElement | null;
  if (fileInput) fileInput.click();
}

export async function handleSinglePanelFileUpload(input: HTMLInputElement): Promise<void> {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  const currentEditingPanelIndex = storyboardStore.getState().currentEditingPanelIndex;
  try {
    const rawDataUrl = await fileToDataUrl(file);
    await replaceSinglePanelAndRestitch(currentEditingPanelIndex, rawDataUrl);
    const dialog = document.getElementById("singlePanelRefineDialog") as HTMLDialogElement | null;
    if (dialog && dialog.open) dialog.close();
    showToast(`✅ 已成功替換 Panel #${currentEditingPanelIndex} 並重新縫合九宮格！`);
  } catch (err: unknown) {
    showToast(`❌ 替換單格圖片失敗：${getErrorMessage(err)}`);
  } finally {
    input.value = "";
  }
}

export async function replaceSinglePanelAndRestitch(panelIdx: number, newImageSrc: string): Promise<void> {
  const normalizedDataUrl = await new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = 640;
      c.height = 480;
      const ctx = c.getContext("2d");
      if (ctx) ctx.drawImage(img, 0, 0, 640, 480);
      resolve(c.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("單格圖片載入失敗"));
    img.src = newImageSrc;
  });

  const nextPanels = {
    ...storyboardStore.getState().slicedPanelsDataUrls,
    [panelIdx]: normalizedDataUrl,
  };
  storyboardStore.setSlicedPanels(nextPanels);
  renderSlicedPanelsBar();

  if (typeof window.H3ProjectStore !== "undefined") {
    const stitchedGridUrl = await window.H3ProjectStore.stitchPanelsToGridDataUrl(nextPanels, 640, 480);
    const gridImg = document.getElementById("plannedGridImg") as HTMLImageElement | null;
    const dl = document.getElementById("downloadGridLink") as HTMLAnchorElement | null;
    if (gridImg) gridImg.src = stitchedGridUrl;
    if (dl) dl.href = stitchedGridUrl;
    const blob = await dataUrlToBlob(stitchedGridUrl);
    storyboardStore.setGridImage(stitchedGridUrl, blob);
  }
  scheduleAutoSave();
}

export async function executeSinglePanelAiRegen(): Promise<void> {
  const prefs = getPrefs();
  const imageProv = (document.getElementById("imageProviderSelect") as HTMLSelectElement | null)?.value || "nano-banana-2";
  const customNote = (document.getElementById("singlePanelPromptInput") as HTMLTextAreaElement | null)?.value?.trim() || "";
  const statusEl = document.getElementById("singlePanelRefineStatus");
  const btn = document.getElementById("singlePanelAiRegenBtn") as HTMLButtonElement;
  const { currentPlan, currentEditingPanelIndex } = storyboardStore.getState();

  const storyDesc = (document.getElementById("chineseDesc") as HTMLTextAreaElement | null)?.value?.trim() || "";
  let segPrompt = "";
  if (currentPlan && Array.isArray(currentPlan.segments)) {
    const matchSeg = currentPlan.segments.find((s) => (s.end_panel || 3) >= currentEditingPanelIndex) || currentPlan.segments[0];
    if (matchSeg) segPrompt = matchSeg.prompt || "";
  }

  const fullPrompt =
    typeof window.H3ProjectStore !== "undefined"
      ? window.H3ProjectStore.buildSinglePanelPrompt({
          panelIndex: currentEditingPanelIndex,
          storyDesc,
          segmentPrompt: segPrompt,
          customInstruction: customNote,
        })
      : `Single cinematic frame for Panel #${currentEditingPanelIndex}. ${customNote}`;

  btn.disabled = true;
  if (statusEl) {
    statusEl.style.display = "block";
    statusEl.style.color = "#7dd3fc";
    statusEl.textContent = `⏳ 正在透過 AI 單獨重繪 Panel #${currentEditingPanelIndex} 並保持主角一致性...`;
  }

  try {
    let newPanelUrl = "";
    if (imageProv.startsWith("nano-banana") || imageProv === "manual") {
      if (!prefs.geminiKey) {
        openSettingsModal();
        throw new Error("請先填入 Google Gemini API Key 以執行 AI 單格重繪");
      }
      const imgModel = imageProv === "nano-banana-pro" ? "gemini-3-pro-image" : "gemini-3.1-flash-image";
      newPanelUrl = await generateGridViaNanoBanana(prefs.geminiKey, imgModel, fullPrompt);
    } else {
      if (!prefs.openaiKey) {
        openSettingsModal();
        throw new Error("請先填入 OpenAI API Key 以執行 AI 單格重繪");
      }
      newPanelUrl = await generateGridViaOpenAI(prefs.openaiKey, prefs.openaiBaseUrl, fullPrompt);
    }

    await replaceSinglePanelAndRestitch(currentEditingPanelIndex, newPanelUrl);
    const previewImg = document.getElementById("singlePanelRefinePreviewImg") as HTMLImageElement | null;
    if (previewImg) previewImg.src = storyboardStore.getState().slicedPanelsDataUrls[currentEditingPanelIndex] || "";
    if (statusEl) {
      statusEl.style.color = "#6ee7b7";
      statusEl.textContent = `✅ Panel #${currentEditingPanelIndex} 重繪完成！已自動更新九宮格總圖與專案存檔。`;
    }
    showToast(`✨ Panel #${currentEditingPanelIndex} AI 單格重繪並縫合完成！`);
  } catch (err: unknown) {
    if (statusEl) {
      statusEl.style.color = "#fca5a5";
      statusEl.textContent = `❌ 重繪失敗：${formatDiagnosticError(err, imageProv).plainText}`;
    }
  } finally {
    btn.disabled = false;
  }
}
