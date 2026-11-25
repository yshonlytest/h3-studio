import type { StoryboardPlan, StoryboardSegment } from "../types/studio.ts";
import { LOCAL_DAEMON_BASE_URL } from "../config/constants.ts";
import { sanitizeUrl } from "../utils/domSafety.ts";
import { formatDiagnosticError, getErrorMessage } from "../utils/errors.ts";
import { createGoldenProjectObject } from "../data/templates.ts";
import { coreStore } from "../stores/coreStore.ts";
import { storyboardStore } from "../stores/storyboardStore.ts";
import {
  copyTextToClipboard,
  escapeHtml,
  getPrefs,
  openSettingsModal,
  selectProjectMode,
  showToast,
} from "./uiShell.ts";
import { openSinglePanelRefinerModal } from "./panelRefiner.ts";
import { appendSegmentCardDOM, onChainParadigmChange, renderPlanUI, syncSegmentsFromDOM } from "./storyboardEditor.ts";
import { applyProjectStateToUI, scheduleAutoSave } from "./workspaceManager.ts";

export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function handleRefUpload(input: HTMLInputElement): Promise<void> {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  const mime = file.type || "image/jpeg";
  const dataUrl = await fileToDataUrl(file);
  storyboardStore.setRefImage(dataUrl.split(",")[1] || "", mime);
  const img = document.getElementById("refPreview") as HTMLImageElement | null;
  if (img) {
    img.src = dataUrl;
    img.style.display = "block";
  }
  const icon = document.getElementById("refPlaceholderIcon");
  if (icon) icon.style.display = "none";
  const btnText = document.getElementById("refUploadBtnText");
  if (btnText) btnText.textContent = "📷 載入圖片 (更換)";
  scheduleAutoSave();
}

export async function handleGridUpload(input: HTMLInputElement): Promise<void> {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  const dataUrl = await fileToDataUrl(file);
  storyboardStore.setGridImage(dataUrl, file);
  const img = document.getElementById("gridUploadPreview") as HTMLImageElement | null;
  if (img) {
    img.src = dataUrl;
    img.style.display = "block";
  }
  showGridPreview(dataUrl);
  scheduleAutoSave();
}

export function renderSlicedPanelsBar(): void {
  const bar = document.getElementById("slicedPanelsContainer");
  if (!bar) return;
  const slicedPanelsDataUrls = storyboardStore.getState().slicedPanelsDataUrls;
  bar.innerHTML = "";
  for (let idx = 1; idx <= 9; idx++) {
    const panelDataUrl = slicedPanelsDataUrls[idx] || "";
    const item = document.createElement("div");
    item.className = "sliced-panel-item";
    item.style.cursor = "pointer";
    item.title = `點擊可單獨 AI 重繪或上傳替換 Panel ${idx}`;
    item.onclick = () => openSinglePanelRefinerModal(idx);
    const safePanelUrl = sanitizeUrl(panelDataUrl, {
      allowDataImage: true,
      allowBlob: true,
      allowRelative: true,
    });
    if (safePanelUrl) {
      const img = document.createElement("img");
      img.src = safePanelUrl;
      img.alt = `Panel ${idx}`;
      const footer = document.createElement("div");
      footer.style.cssText = "display:flex; justify-content:space-between; align-items:center; width:100%; padding:2px 4px; gap:4px;";
      const labelSpan = document.createElement("span");
      labelSpan.textContent = `Panel ${idx}`;
      const badgeSpan = document.createElement("span");
      badgeSpan.style.cssText = "font-size:0.65rem; color:#38bdf8; background:rgba(56,189,248,0.16); padding:1px 5px; border-radius:4px; border:1px solid rgba(56,189,248,0.4);";
      badgeSpan.textContent = "✨ 精修";
      footer.appendChild(labelSpan);
      footer.appendChild(badgeSpan);
      item.appendChild(img);
      item.appendChild(footer);
    } else {
      const span = document.createElement("span");
      span.textContent = `Panel ${idx}`;
      item.appendChild(span);
    }
    bar.appendChild(item);
  }
}

export function sliceNineGridInBrowser(imgSrc: string): Promise<Record<string, string>> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const gw = img.naturalWidth || img.width;
      const gh = img.naturalHeight || img.height;
      const pw = Math.floor(gw / 3);
      const ph = Math.floor(gh / 3);
      const pad = 6;
      const panels: Record<string, string> = {};

      for (let idx = 1; idx <= 9; idx++) {
        const r = Math.floor((idx - 1) / 3);
        const c = (idx - 1) % 3;
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 480;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, c * pw + pad, r * ph + pad, pw - pad * 2, ph - pad * 2, 0, 0, 640, 480);
        }
        try {
          const panelDataUrl = canvas.toDataURL("image/png");
          panels[idx] = panelDataUrl;
        } catch (err) {
          console.debug("Failed to export sliced panel:", idx, err);
        }
      }
      storyboardStore.setSlicedPanels(panels);
      renderSlicedPanelsBar();
      resolve(panels);
    };
    img.onerror = () => resolve({});
    img.src = imgSrc;
  });
}

export function showGridPreview(dataUrl: string | null): void {
  storyboardStore.patchStoryboard({ gridImageDataUrl: dataUrl || "" });
  const box = document.getElementById("gridPreviewContainer");
  const img = document.getElementById("plannedGridImg") as HTMLImageElement | null;
  const dl = document.getElementById("downloadGridLink") as HTMLAnchorElement | null;
  if (dataUrl && img && dl) {
    img.style.display = "";
    dl.style.display = "";
    img.src = dataUrl;
    dl.href = dataUrl;
  } else if (img && dl) {
    img.style.display = "none";
    dl.style.display = "none";
  }
  const paradigm = (document.getElementById("chainParadigmSelect") as HTMLSelectElement | null)?.value || "latent_chain";
  if (box) box.style.display = paradigm === "grid_keyframes" ? "block" : "none";
  if (dataUrl) {
    sliceNineGridInBrowser(dataUrl);
  }
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return await res.blob();
}

export function buildDirectorSystemPrompt(durationMode: string, targetSeconds: number, paradigm = "latent_chain"): string {
  if (typeof window.H3PromptBuilder !== "undefined" && window.H3PromptBuilder.buildDirectorSystemPrompt) {
    return window.H3PromptBuilder.buildDirectorSystemPrompt(durationMode, targetSeconds, paradigm);
  }
  const durationInstruction =
    durationMode === "expand"
      ? `The user explicitly requested a total video duration of ${targetSeconds} seconds (${Math.max(1, Math.round(targetSeconds / 5))} segments of 5 seconds each). You MUST expand, enrich, and pace the user's Chinese story into a rich, unhurried ${targetSeconds}-second screenplay consisting of exactly ${Math.max(1, Math.round(targetSeconds / 5))} sequential 5-second segments!`
      : `Analyze the user's Chinese story complexity, actions, and dialogue length, and freely determine the optimal total duration in seconds (must be a multiple of 5, e.g., 5, 10, 15, 20, 25, 30, etc. — do NOT artificially cap at 15s if the plot needs 20s or 25s!). Create N = recommended_total_seconds / 5 sequential 5-second segments so no segment feels rushed.`;

  return `You are an expert AI Film Director specializing in First/Last-Frame Chained Video Generation and 5D Context-IR Prompt Engineering.
The user provides a character/setting reference image and a creative story description in Chinese.

YOUR TASKS & WORKFLOW:
1. ${durationInstruction}
2. 3x3 Storyboard Contact Sheet (9 Key Milestones):
   - Plan a 3x3 nine-panel photo grid (Panel 1 to Panel 9, read left-to-right, top-to-bottom: Row 1 = Panels 1, 2, 3; Row 2 = Panels 4, 5, 6; Row 3 = Panels 7, 8, 9).
   - Write \`grid_image_prompt\` in English to generate this 3x3 photo grid (thin white lines only, strictly NO text, NO captions, NO subtitles anywhere in image) maintaining exact character identity and scene atmosphere from the reference image.
3. Sequential 5-Second Segments (5D Context-IR Chained Storyboard Video Prompts):
   - For EACH segment (Segment 1 to Segment N):
     A. \`title\` (Chinese Milestone Summary): MUST be in Traditional Chinese (繁體中文), stating the part number, timecode, and a clear story milestone summary (e.g., "Part 1 (0-5s): 裂空急墜・雲海截殺").
     B. \`end_panel\`: The target milestone panel index in the 3x3 grid (integer from 1 to 9, monotonically increasing from Segment 1 up to 9 on the final segment).
     C. \`chain_mode\`: "first_frame" for Segment 1, and "${paradigm === "grid_keyframes" ? "first_frame" : "motion_context"}" for Segments 2..N.
     D. \`context_ir\`: Structured 5D object \`{ "scene": "...", "camera": "...", "action": "0-2.5s: ... 2.5-5.0s: ...", "look": "...", "audio": "..." }\`.
     E. \`prompt\` (English 5D Cinematic Video Prompt): Explicitly structured as \`[Scene] ... [Camera] ... Timeline: 0-2.5s: ... 2.5-5.0s: ... [Look] ... Audio: ...\`.
        - Segment 2 to N MUST start with: "Create a 5-second live-action cinematic film continuing seamlessly from the exact last frame, pose, camera angle, and lighting of the previous segment." and re-state core character facial/costume visual anchors in text.
        - Chinese Spoken Dialogue: Embed \`<d>[Chinese] 台詞內容</d>\` inside BOTH \`Timeline:\` and \`Audio:\`.

Return ONLY valid JSON matching this schema:
{
  "project_slug": "short_english_slug",
  "recommended_total_seconds": 25,
  "reasoning_zh": "繁體中文說明：為什麼評估此秒數最適合，以及如何鋪陳起承轉合",
  "expanded_story_zh": "擴寫後的完整繁體中文分鏡故事大綱",
  "grid_image_prompt": "A seamless 3x3 nine-panel photo grid...",
  "segments": [
    {
      "title": "Part 1 (0-5s): 繁體中文段落標題與情節說明",
      "end_panel": 2,
      "chain_mode": "first_frame",
      "context_ir": { "scene": "...", "camera": "...", "action": "...", "look": "...", "audio": "..." },
      "prompt": "[Scene] ... [Camera] ... Timeline: 0-2.5s: ... 2.5-5.0s: ... [Look] ... Audio: ... <d>[Chinese] 台詞</d>."
    }
  ]
}`;
}

export function buildAgentPlanTaskPack(desc: string, durationMode: string, targetSec: number, chainParadigm: string): string {
  const sysPrompt = buildDirectorSystemPrompt(durationMode, targetSec, chainParadigm);
  if (window.H3Prompts && typeof window.H3Prompts.buildStage1ScreenplayTaskPrompt === "function") {
    return window.H3Prompts.buildStage1ScreenplayTaskPrompt({
      desc,
      sysPrompt,
      chainParadigm,
    });
  }
  const extra =
    chainParadigm === "grid_keyframes"
      ? `\n\n【九宮格圖】你需使用你自己的生圖能力（Claude / Gemini Canvas / gpt-image 等訂閱內建生圖），依 \`grid_image_prompt\` 產生一張 3×3 九宮格 PNG（Panel 1~9 由左至右、由上至下，格間細白線，全圖不可含任何文字或浮水印）。擇一交付：(a) 存成 PNG 檔給使用者，再到步驟二點「📁 更換九宮格圖」上傳；(b) 將圖片轉為 data URL，放進 JSON 的 "grid_image_dataurl" 欄位。`
      : "";
  return `你是我的影片導演 Agent。請嚴格依照下方【規格系統提示】，把我在【我的故事】中的中文情節轉譯為分鏡 JSON。只回傳一份合法 JSON（不加任何說明文字，也不要用 code fence 包裹${chainParadigm === "grid_keyframes" ? "，期間按需先生成九宮格圖" : ""}）。

【規格系統提示】
${sysPrompt}

【我的故事】
${desc}${extra}

【交付要求】回傳的 JSON 必須可直接被網頁匯入：僅在需要說明時附一句繁體中文，其餘嚴守 JSON schema。`;
}

export function copyAgentPlanPack(): void {
  const textarea = document.getElementById("agentPlanPackTextarea") as HTMLTextAreaElement | null;
  if (!textarea || !textarea.value.trim()) {
    showToast("⚠️ 尚未生成 Agent 任務包，請先按下「生成分鏡腳本」");
    return;
  }
  copyTextToClipboard(textarea.value, "📋 已複製 Agent 任務包！貼到你的 Agent（Claude Code / Antigravity / Codex）即可");
}

export function normalizeAgentPlan(rawPlan: unknown): { plan: StoryboardPlan; gridDataUrl: string } {
  if (!rawPlan || typeof rawPlan !== "object" || Array.isArray(rawPlan)) {
    throw new Error("JSON 需為一個物件（含 segments 或整份分鏡 plan）");
  }
  const plan = rawPlan as Record<string, unknown>;
  const rawSegs = Array.isArray(plan.segments) ? plan.segments : null;
  if (!rawSegs || rawSegs.length === 0) {
    throw new Error("缺少非空的 segments 陣列");
  }
  const segments: StoryboardSegment[] = rawSegs.map((rawSeg: unknown, i: number) => {
    const seg = (rawSeg && typeof rawSeg === "object" ? rawSeg : {}) as Record<string, unknown>;
    if (!String(seg.prompt || "").trim()) {
      throw new Error(`segments[${i}].prompt 不可為空（Agent 需輸出 5D 英文影片提示詞）`);
    }
    const dialogueVal =
      typeof seg.dialogue === "string" ? seg.dialogue : typeof seg.display_dialogue === "string" ? seg.display_dialogue : "";
    return {
      segment: i + 1,
      shot_id: (seg.shot_id as number | string | undefined) || i + 1,
      title: String(seg.title || `Part ${i + 1}`).trim(),
      end_panel: Math.max(1, Math.min(9, Number(seg.end_panel) || (i === 0 ? 1 : 3))),
      chain_mode:
        seg.chain_mode === "first_frame"
          ? "first_frame"
          : seg.chain_mode === "motion_context"
            ? "motion_context"
            : i === 0
              ? "first_frame"
              : "motion_context",
      frames: Number(seg.frames) > 0 ? Number(seg.frames) : 124,
      shot_type: typeof seg.shot_type === "string" ? seg.shot_type : "presenter_chart",
      first_frame: typeof seg.first_frame === "string" ? seg.first_frame : undefined,
      context_ir:
        seg.context_ir && typeof seg.context_ir === "object" ? (seg.context_ir as Record<string, unknown>) : undefined,
      prompt: String(seg.prompt).trim(),
      dialogue: dialogueVal,
      display_dialogue: typeof seg.display_dialogue === "string" ? seg.display_dialogue : dialogueVal,
      spoken_dialogue: typeof seg.spoken_dialogue === "string" ? seg.spoken_dialogue : dialogueVal,
    };
  });
  const rawSlug = plan.project_slug || plan.project || plan.title || "agent_storyboard";
  const cleanSlug =
    String(rawSlug).replace(/_\d+(?:\.\d+)?s$/i, "").replace(/[^a-zA-Z0-9_-]/g, "_") || "agent_storyboard";
  const normalized: StoryboardPlan = {
    project_slug: cleanSlug,
    recommended_total_seconds: Number(plan.recommended_total_seconds) || segments.length * 5,
    project_mode:
      typeof plan.project_mode === "string"
        ? plan.project_mode
        : plan.global_profile || plan.shots
          ? "edu_explainer"
          : undefined,
    global_profile: plan.global_profile,
    anchor_ref_image: typeof plan.anchor_ref_image === "string" ? plan.anchor_ref_image : undefined,
    revision: plan.revision,
    reasoning_zh: String(plan.reasoning_zh || "由 Agent 訂閱額度代寫的分鏡"),
    expanded_story_zh: String(plan.expanded_story_zh || ""),
    grid_image_prompt: String(plan.grid_image_prompt || ""),
    segments,
  };
  let gridDataUrl = "";
  if (typeof plan.grid_image_dataurl === "string" && plan.grid_image_dataurl.startsWith("data:image/")) {
    gridDataUrl = plan.grid_image_dataurl;
  }
  return { plan: normalized, gridDataUrl };
}

export function applyGridDataUrl(dataUrl: string): void {
  if (!dataUrl) return;
  showGridPreview(dataUrl);
  storyboardStore.patchStoryboard({ gridImageDataUrl: dataUrl });
  dataUrlToBlob(dataUrl)
    .then((blob) => {
      storyboardStore.patchStoryboard({ gridImageBlob: blob });
    })
    .catch((err) => {
      console.debug("dataUrlToBlob skipped:", err);
    });
  scheduleAutoSave();
}

export async function importAgentStoryboardJSON(): Promise<void> {
  const input = document.getElementById("agentStoryboardJsonInput") as HTMLTextAreaElement;
  const statusEl = document.getElementById("agentImportStatus")!;
  try {
    let text = (input.value || "").trim();
    if (!text) throw new Error("請先貼上 Agent 回傳的分鏡 JSON");
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) text = fence[1].trim();
    const firstBrace = text.indexOf("{");
    if (firstBrace > 0) text = text.slice(firstBrace);
    const parsed = JSON.parse(text);
    const mode = (document.querySelector("input[name=agentImportMode]:checked") as HTMLInputElement | null)?.value || "replace";
    const { plan, gridDataUrl } = normalizeAgentPlan(parsed);

    if (mode === "append") {
      if (!storyboardStore.getState().currentPlan) {
        storyboardStore.setPlan({ project_slug: "custom_story", recommended_total_seconds: 5, reasoning_zh: "", expanded_story_zh: "", segments: [] });
      }
      const baseIdx = (document.querySelectorAll("#segmentsContainer .segment-card") || []).length;
      plan.segments.forEach((seg, i) => appendSegmentCardDOM(seg, baseIdx + i));
      syncSegmentsFromDOM();
      showToast(`✅ 已追加 ${plan.segments.length} 段 Agent 產出的分鏡`);
    } else {
      renderPlanUI(plan);
      applyChainParadigmFromPlan(plan);
    }
    if (gridDataUrl) applyGridDataUrl(gridDataUrl);
    statusEl.style.color = "#6ee7b7";
    statusEl.textContent = "✅ 匯入成功！請到步驟二檢視與微調";
    (document.getElementById("agentStoryboardImportDialog") as HTMLDialogElement).close();
    input.value = "";
  } catch (err: unknown) {
    statusEl.textContent = `❌ 匯入失敗：${getErrorMessage(err)}`;
  }
}

export function applyChainParadigmFromPlan(plan: StoryboardPlan): void {
  const select = document.getElementById("chainParadigmSelect") as HTMLSelectElement | null;
  if (!select) return;
  const segs = plan.segments || [];
  const isGridPlan = segs.some((seg, i) => i > 0 && seg.chain_mode === "first_frame");
  const paradigm = isGridPlan || plan.grid_image_prompt ? "grid_keyframes" : "latent_chain";
  if (select.value !== paradigm) {
    select.value = paradigm;
    onChainParadigmChange(true);
  }
}

export function H3StudioApplyPlan(planOrSegments: unknown, options: Record<string, unknown> = {}): boolean {
  const mode = options.mode || (Array.isArray(planOrSegments) ? "append" : "replace");
  const normalized = normalizeAgentPlan(Array.isArray(planOrSegments) ? { segments: planOrSegments } : planOrSegments);
  if (mode === "append") {
    if (!storyboardStore.getState().currentPlan) {
      storyboardStore.setPlan({ project_slug: "custom_story", recommended_total_seconds: 5, reasoning_zh: "", expanded_story_zh: "", segments: [] });
    }
    const baseIdx = (document.querySelectorAll("#segmentsContainer .segment-card") || []).length;
    normalized.plan.segments.forEach((seg, i) => appendSegmentCardDOM(seg, baseIdx + i));
    syncSegmentsFromDOM();
    showToast(`✅ 已由 Agent 追加 ${normalized.plan.segments.length} 段分鏡`);
  } else {
    renderPlanUI(normalized.plan);
    applyChainParadigmFromPlan(normalized.plan);
    showToast("✅ 已由 Agent 帶入完整分鏡！請到步驟二檢視");
  }
  if (normalized.gridDataUrl) applyGridDataUrl(normalized.gridDataUrl);
  return true;
}

export function openAgentStoryboardImport(mode?: string): void {
  const dialog = document.getElementById("agentStoryboardImportDialog") as HTMLDialogElement | null;
  if (!dialog) return;
  if (mode && mode !== "") {
    const radio = document.querySelector(`input[name=agentImportMode][value="${mode}"]`) as HTMLInputElement | null;
    if (radio) radio.checked = true;
  }
  const statusEl = document.getElementById("agentImportStatus");
  if (statusEl) statusEl.textContent = "";
  dialog.showModal();
}

export async function fetchWithProxy(targetUrl: string, options: RequestInit = {}): Promise<Response> {
  const isPublicWeb =
    window.location.protocol.startsWith("http") &&
    !window.location.hostname.includes("127.0.0.1") &&
    !window.location.hostname.includes("localhost");
  if (isPublicWeb && !targetUrl.startsWith("/")) {
    const proxyUrl = `/api/proxy?target=${encodeURIComponent(targetUrl)}`;
    return await fetch(proxyUrl, options);
  }
  try {
    return await fetch(targetUrl, options);
  } catch (err) {
    if (isPublicWeb && !targetUrl.startsWith("/")) {
      const proxyUrl = `/api/proxy?target=${encodeURIComponent(targetUrl)}`;
      return await fetch(proxyUrl, options);
    }
    throw err;
  }
}

export async function callPlanViaGemini(
  apiKey: string,
  modelName: string,
  systemPrompt: string,
  chineseDesc: string
): Promise<StoryboardPlan> {
  const { refImageBase64, refImageMime } = storyboardStore.getState();
  const inputArr: Array<Record<string, unknown>> = [];
  if (refImageBase64) {
    inputArr.push({ type: "image", mime_type: refImageMime, data: refImageBase64 });
  }
  inputArr.push({ type: "text", text: `使用者中文描述：${chineseDesc}` });

  const res = await fetchWithProxy("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
      "Api-Revision": "2026-05-20",
    },
    body: JSON.stringify({
      model: modelName,
      system_instruction: systemPrompt,
      input: inputArr,
      response_format: { type: "text", mime_type: "application/json" },
    }),
  });
  if (!res.ok) throw new Error(`Gemini API 錯誤 (${res.status}): ${await res.text()}`);
  const data = await res.json();
  let text = data.output_text || "";
  if (!text && data.steps) {
    for (const s of data.steps) {
      if (s.type === "model_output" && s.content) {
        for (const c of s.content) {
          if (c.type === "text" && c.text) text += c.text;
        }
      }
    }
  }
  return JSON.parse(text.replace(/^```json\s*|\s*```$/g, "").trim());
}

export async function callPlanViaOpenAI(
  apiKey: string,
  baseUrl: string,
  modelName: string,
  systemPrompt: string,
  chineseDesc: string
): Promise<StoryboardPlan> {
  const { refImageBase64, refImageMime } = storyboardStore.getState();
  const userContent: Array<Record<string, unknown>> = [];
  if (refImageBase64) {
    userContent.push({
      type: "image_url",
      image_url: { url: `data:${refImageMime};base64,${refImageBase64}` },
    });
  }
  userContent.push({ type: "text", text: `使用者中文描述：${chineseDesc}` });

  const res = await fetchWithProxy(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelName,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI API 錯誤 (${res.status}): ${await res.text()}`);
  const data = await res.json();
  const text = data.choices[0].message.content;
  return JSON.parse(text.replace(/^```json\s*|\s*```$/g, "").trim());
}

export async function generateGridViaNanoBanana(apiKey: string, modelName: string, gridPrompt: string): Promise<string> {
  const { refImageBase64, refImageMime } = storyboardStore.getState();
  const inputArr: any[] = [];
  if (refImageBase64) {
    inputArr.push({ type: "image", mime_type: refImageMime, data: refImageBase64 });
  }
  inputArr.push({ type: "text", text: gridPrompt });

  const res = await fetchWithProxy("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
      "Api-Revision": "2026-05-20",
    },
    body: JSON.stringify({
      model: modelName,
      input: inputArr,
      response_format: { type: "image", aspect_ratio: "4:3" },
    }),
  });
  if (!res.ok) throw new Error(`Nano Banana 生圖錯誤 (${res.status}): ${await res.text()}`);
  const data = await res.json();
  if (data.output_image && data.output_image.data) {
    const mime = data.output_image.mime_type || "image/png";
    return `data:${mime};base64,${data.output_image.data}`;
  }
  if (data.steps) {
    for (const s of data.steps) {
      if (s.type === "model_output" && s.content) {
        for (const c of s.content) {
          if (c.type === "image" && c.data) return `data:${c.mime_type || "image/png"};base64,${c.data}`;
        }
      }
    }
  }
  throw new Error("Nano Banana 未回傳影像資料");
}

export async function generateGridViaOpenAI(apiKey: string, baseUrl: string, gridPrompt: string): Promise<string> {
  const res = await fetchWithProxy(`${baseUrl}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-image-1",
      prompt: gridPrompt,
      size: "1536x1024",
      quality: "high",
    }),
  });
  if (!res.ok) throw new Error(`OpenAI Image API 錯誤 (${res.status}): ${await res.text()}`);
  const data = await res.json();
  const item = data.data[0];
  if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;
  if (item.url) return item.url;
  throw new Error("OpenAI Image API 未回傳影像");
}

export async function loadGoldenTemplate(templateKey: string): Promise<void> {
  const mode = templateKey === "tutorial_140s" ? "edu" : "creative";
  selectProjectMode(mode, false);

  const statusEl = document.getElementById("planStatusMsg");
  if (statusEl) {
    statusEl.style.color = "var(--muted)";
    statusEl.textContent = `⏳ 正在載入示範範本 (${templateKey})...`;
  }

  const projObj = createGoldenProjectObject(templateKey);
  if (typeof window.H3ProjectStore !== "undefined") {
    try {
      await window.H3ProjectStore.saveProject(projObj);
      await window.H3ProjectStore.setLastActiveProjectId(projObj.id);
    } catch (err) {
      console.debug("Golden template persistence skipped:", err);
    }
  }

  await applyProjectStateToUI(projObj);

  const paradigmSelect = document.getElementById("chainParadigmSelect") as HTMLSelectElement | null;
  if (paradigmSelect) {
    paradigmSelect.value = templateKey === "detective" ? "grid_keyframes" : "latent_chain";
  }

  const tplName =
    templateKey === "tutorial_140s"
      ? "H3工作流教學（105s實測指南）"
      : templateKey === "ink_sorcerer"
        ? "墨繪靈境（潛空間專屬）"
        : "賽博偵探（九宮格專屬）";

  if (statusEl) {
    statusEl.style.color = "var(--success)";
    statusEl.innerHTML = `✅ 已載入「${escapeHtml(projObj.plan.title)}」！ <button type="button" class="btn" onclick="document.getElementById('step2Card')?.scrollIntoView({behavior:'smooth'})" style="margin-left:8px; padding:4px 10px; font-size:0.78rem; border-color:#38bdf8; color:#7dd3fc;">⬇️ 前往步驟二微調</button>`;
  }
  showToast(`✅ 已載入「${tplName}」示範專案`);
}

export async function callPlanViaLocalLLM(chineseDesc: string, durationMode: string, targetSec: number): Promise<StoryboardPlan> {
  const segCount = durationMode === "custom" ? Math.max(1, Math.min(6, Math.round(targetSec / 5))) : 5;
  const cameraTracks = [
    { start: [0.0, 0.85], end: [0.0, 0.3], subject: [0.0, -0.1], label: "Low-angle tracking dolly-in shot" },
    { start: [-0.65, 0.4], end: [0.65, 0.4], subject: [0.0, 0.0], label: "Dynamic 60-degree orbital arc shot" },
    { start: [0.0, 0.6], end: [0.0, 0.2], subject: [0.0, -0.1], label: "Tight push-in medium close-up shot" },
    { start: [-0.7, 0.45], end: [0.7, 0.35], subject: [0.0, -0.2], label: "Rapid whip-pan into lateral truck shot" },
    { start: [0.0, 0.25], end: [0.0, 0.9], subject: [0.0, -0.1], label: "Grand ascending pull-back reveal shot" },
    { start: [0.4, 0.7], end: [-0.4, 0.3], subject: [0.0, 0.0], label: "Sweeping crane tracking finale shot" },
  ];
  let baseExpanded = "";
  try {
    const res = await fetch(`${LOCAL_DAEMON_BASE_URL}/api/expand`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        context_ir: {
          scene: chineseDesc,
          action: `0-2.5s: Protagonist initiates dynamic movement in ${chineseDesc}. 2.5-5.0s: Climactic action escalates with clear cause-and-effect momentum`,
          camera: cameraTracks[0].label,
          look: "High-contrast cinematic 35mm anamorphic film, volumetric lighting, realistic physics",
          audio: "Immersive environmental foley and dramatic cinematic score",
        },
        camera_track: {
          start: cameraTracks[0].start,
          end: cameraTracks[0].end,
          subject: cameraTracks[0].subject,
        },
        use_llm: true,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      baseExpanded = data.prompt || data.expanded_prompt || "";
    }
  } catch (err) {
    console.debug("Local LLM expand offline fallback:", err);
  }

  const segments = [];
  for (let i = 0; i < segCount; i++) {
    const camSpec = cameraTracks[i % cameraTracks.length];
    const prefix =
      i === 0 ? "" : "Create a 5-second live-action cinematic film continuing seamlessly from the exact last frame, pose, camera angle, and momentum. ";
    const compiled =
      i === 0 && baseExpanded
        ? baseExpanded
        : `${prefix}[Scene] ${chineseDesc}. [Camera] ${camSpec.label}. Timeline: 0-2.5s: Protagonist advances through segment ${i + 1} with decisive momentum. 2.5-5.0s: Executes key dramatic action with realistic cloth and lighting physics. [Look] Cinematic 35mm anamorphic lens, rich volumetric lighting. Audio: Dynamic environmental foley and synchronized atmospheric sound.`;
    segments.push({
      segment: i + 1,
      title: `Part ${i + 1} (${i * 5}-${(i + 1) * 5}s)`,
      end_panel: Math.min(9, i * 2 + 1),
      chain_mode: i === 0 ? "first_frame" : "motion_context",
      prompt: compiled,
    });
  }
  return {
    project_slug: "local_context_ir_storyboard",
    recommended_total_seconds: segments.length * 5,
    reasoning_zh: baseExpanded
      ? "已透過本機 h3_server (/api/expand) 5D Context-IR + 2D 運鏡向量完成分鏡編排"
      : "已透過內建 5D Context-IR 結構化編排引擎生成連貫分鏡（本機守護進程離線備援）",
    expanded_story_zh: chineseDesc,
    grid_image_prompt: `3x3 cinematic storyboard grid of ${chineseDesc}`,
    segments,
  };
}

export interface PlanDispatchOptions {
  promptProvider: string;
  desc: string;
  durationMode: string;
  targetSec: number;
  sysPrompt: string;
  prefs: ReturnType<typeof getPrefs>;
}

interface GridImageDispatchOptions {
  imageProvider: string;
  gridPrompt: string;
  prefs: ReturnType<typeof getPrefs>;
}

export async function dispatchPlanByProvider(options: PlanDispatchOptions): Promise<StoryboardPlan> {
  const { promptProvider, desc, durationMode, targetSec, sysPrompt, prefs } = options;
  if (promptProvider === "local-llm") {
    return await callPlanViaLocalLLM(desc, durationMode, targetSec);
  }
  if (promptProvider.startsWith("gemini")) {
    if (!prefs.geminiKey) {
      openSettingsModal();
      throw new Error("請先在設定視窗填入 Google Gemini API Key");
    }
    const model = promptProvider === "gemini-pro" ? "gemini-3.1-pro-preview" : "gemini-3.8-flash";
    return await callPlanViaGemini(prefs.geminiKey, model, sysPrompt, desc);
  }
  if (!prefs.openaiKey) {
    openSettingsModal();
    throw new Error("請先在設定視窗填入 OpenAI API Key");
  }
  return await callPlanViaOpenAI(prefs.openaiKey, prefs.openaiBaseUrl, prefs.openaiModel, sysPrompt, desc);
}

async function generateStep1GridImage(options: GridImageDispatchOptions): Promise<string> {
  const { imageProvider, gridPrompt, prefs } = options;
  if (imageProvider.startsWith("nano-banana")) {
    if (!prefs.geminiKey) {
      openSettingsModal();
      throw new Error("請先填入 Gemini API Key 以使用 Nano Banana 生圖");
    }
    const imgModel = imageProvider === "nano-banana-pro" ? "gemini-3-pro-image" : "gemini-3.1-flash-image";
    return await generateGridViaNanoBanana(prefs.geminiKey, imgModel, gridPrompt);
  }
  if (!prefs.openaiKey) {
    openSettingsModal();
    throw new Error("請先填入 OpenAI API Key 以使用 OpenAI Image 生圖");
  }
  return await generateGridViaOpenAI(prefs.openaiKey, prefs.openaiBaseUrl, gridPrompt);
}

export async function executeStep1(): Promise<void> {
  const prefs = getPrefs();
  const promptProv = (document.getElementById("promptProviderSelect") as HTMLSelectElement).value;
  const imageProv = (document.getElementById("imageProviderSelect") as HTMLSelectElement).value;
  const chainParadigm = (document.getElementById("chainParadigmSelect") as HTMLSelectElement | null)?.value || "latent_chain";
  const desc = (document.getElementById("chineseDesc") as HTMLTextAreaElement).value.trim();
  const durationMode = (document.getElementById("durationModeSelect") as HTMLSelectElement).value;
  const targetSec = parseInt((document.getElementById("targetSecondsInput") as HTMLInputElement).value, 10) || 15;
  const statusEl = document.getElementById("planStatusMsg")!;
  const btn = document.getElementById("planBtn") as HTMLButtonElement;

  if (!desc) {
    statusEl.style.color = "var(--danger)";
    statusEl.textContent = "❌ 請先輸入中文情節描述";
    return;
  }
  const origBtnText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "⏳ 正在規劃分鏡腳本...";
  const agentPackBox = document.getElementById("agentPlanPackBox");
  if (promptProv !== "agent-llm" && agentPackBox) agentPackBox.style.display = "none";
  const stepStages = ["① 分析故事結構與角色特徵…", "② 擴寫多幕情節與對白時間軸…", "③ 編譯 5D 場景 / 運鏡 / 動作腳本…"];
  let stageIdx = 0;
  const renderStep1Progress = (msg: string) => {
    statusEl.style.color = "#7dd3fc";
    statusEl.innerHTML = `
          <div style="margin-top:6px; padding:8px 12px; background:rgba(2,132,199,0.12); border:1px solid rgba(56,189,248,0.3); border-radius:8px;">
            <div style="font-weight:600; margin-bottom:4px;">⏳ ${escapeHtml(msg)}</div>
            <div style="display:flex; gap:8px; font-size:0.76rem; color:#94a3b8;">
              ${stepStages.map((s, idx) => `<span style="color:${idx <= stageIdx ? "#38bdf8" : "#475569"}; font-weight:${idx === stageIdx ? "700" : "400"};">${escapeHtml(s)}</span>`).join(" ➔ ")}
            </div>
          </div>`;
  };
  renderStep1Progress(stepStages[0]);
  const stageTimer = setInterval(() => {
    if (stageIdx < stepStages.length - 1) {
      stageIdx++;
      renderStep1Progress(stepStages[stageIdx]);
    }
  }, 2200);

  try {
    const sysPrompt = buildDirectorSystemPrompt(durationMode, targetSec, chainParadigm);

    let plan: StoryboardPlan;
    if (promptProv === "agent-llm") {
      clearInterval(stageTimer);
      btn.disabled = false;
      btn.textContent = origBtnText;
      const packBox = document.getElementById("agentPlanPackBox");
      const packText = document.getElementById("agentPlanPackTextarea") as HTMLTextAreaElement | null;
      if (packBox && packText) {
        packText.value = buildAgentPlanTaskPack(desc, durationMode, targetSec, chainParadigm);
        packBox.style.display = "block";
      }
      statusEl.style.color = "#fcd34d";
      statusEl.innerHTML = `
            <div style="margin-top:6px; padding:8px 12px; background:rgba(245,158,11,0.12); border:1px solid rgba(245,158,11,0.4); border-radius:8px;">
              🤖 <strong>Agent 任務包就緒</strong>：複製上方文字貼給你的 Agent → 它會用你的訂閱額度生成分鏡 JSON → 點「📄 貼上 Agent 分鏡 JSON」匯入（或讓 Agent 呼叫 <code>window.H3StudioApplyPlan()</code>）。
            </div>`;
      return;
    }

    if (promptProv === "local-llm") {
      renderStep1Progress("🧠 正在呼叫本機 5D 引擎規劃腳本...");
    }
    plan = await dispatchPlanByProvider({
      promptProvider: promptProv,
      desc,
      durationMode,
      targetSec,
      sysPrompt,
      prefs,
    });

    if (chainParadigm === "grid_keyframes" && (imageProv.startsWith("nano-banana") || imageProv === "openai-image")) {
      renderStep1Progress("🎨 正在生成 3×3 九宮格分鏡圖...");
      const gridPrompt = plan.grid_image_prompt || `3x3 cinematic storyboard grid of ${desc}`;
      const dataUrl = await generateStep1GridImage({
        imageProvider: imageProv,
        gridPrompt,
        prefs,
      });
      showGridPreview(dataUrl);
      storyboardStore.patchStoryboard({ gridImageBlob: await dataUrlToBlob(dataUrl) });
    } else if (chainParadigm === "grid_keyframes" && imageProv === "agent-image" && plan.grid_image_prompt) {
      showGridPreview(null);
    } else if (chainParadigm === "latent_chain") {
      const gridContainer = document.getElementById("gridPreviewContainer");
      if (gridContainer) gridContainer.style.display = "none";
    }

    const currentActiveProjectId = coreStore.getState().currentActiveProjectId;
    if (
      (currentActiveProjectId === "fc_shisa_demo" ||
        currentActiveProjectId === "fc_cinema_demo" ||
        currentActiveProjectId === "fc_detective_25s_demo") &&
      typeof window.H3ProjectStore !== "undefined"
    ) {
      const newProjId = window.H3ProjectStore.generateProjectId();
      const newProjName = plan.project_slug || "AI 生成分鏡專案";
      coreStore.setActiveProject(newProjId, newProjName);
      const nameInput = document.getElementById("currentProjectNameInput") as HTMLInputElement | null;
      if (nameInput) nameInput.value = newProjName;
    }
    selectProjectMode("creative");
    renderPlanUI(plan);
    scheduleAutoSave();
    statusEl.style.color = "var(--success)";
    statusEl.innerHTML = `✅ 已產出 ${plan.segments.length * 5} 秒（共 ${plan.segments.length} 段）分鏡腳本！ <button type="button" class="btn" onclick="document.getElementById('step2Card')?.scrollIntoView({behavior:'smooth'})" style="margin-left:8px; padding:4px 10px; font-size:0.78rem; border-color:#38bdf8; color:#7dd3fc;">⬇️ 前往步驟二微調</button>`;
    showToast(`✅ 分鏡腳本生成完成（共 ${plan.segments.length} 段）！`);
  } catch (err: unknown) {
    statusEl.style.color = "var(--danger)";
    const diag = formatDiagnosticError(err, promptProv);
    if (diag.title) {
      statusEl.innerHTML = `❌ <strong>${escapeHtml(diag.title)}</strong>：${escapeHtml(diag.reason)}${diag.action ? `<div style="margin-top:4px; font-size:0.8rem; color:#fde047;">👉 ${escapeHtml(diag.action)}</div>` : ""}`;
    } else {
      statusEl.textContent = `❌ ${diag.plainText}`;
    }
  } finally {
    clearInterval(stageTimer);
    btn.disabled = false;
    btn.textContent = origBtnText;
  }
}
