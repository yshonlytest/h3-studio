import { showToast } from "./uiShell.ts";
import { syncSegmentsFromDOM, updateSinglePromptSection } from "./storyboardEditor.ts";

export interface StagingPoint {
  x: number;
  y: number;
}

export interface StagingTrack {
  start: StagingPoint;
  end: StagingPoint;
  subject: StagingPoint;
}

export interface StagingCanvasElement extends HTMLCanvasElement {
  _track?: StagingTrack;
  _hoverKey?: keyof StagingTrack | null;
}

export function onStagingDetailsToggle(detailsEl: HTMLDetailsElement): void {
  if (detailsEl.open) {
    const canvas = detailsEl.querySelector<StagingCanvasElement>(".staging-canvas");
    if (canvas) initStagingTrack(canvas);
  }
}

export function initStagingTrack(canvas: StagingCanvasElement): void {
  if (!canvas._track) {
    canvas._track = {
      start: { x: 0.0, y: 0.7 },
      end: { x: 0.0, y: 0.2 },
      subject: { x: 0.0, y: -0.2 },
    };
    setupStagingEvents(canvas);
  }
  drawStagingTrack(canvas);
  updateStagingPreview(canvas);
}

export function stagingCoordToPx(pt: StagingPoint): StagingPoint {
  return { x: 140 + pt.x * 58, y: 80 + pt.y * 55 };
}

export function stagingPxToCoord(px: number, py: number): StagingPoint {
  return {
    x: Math.max(-1.3, Math.min(1.3, (px - 140) / 58)),
    y: Math.max(-1.1, Math.min(1.1, (py - 80) / 55)),
  };
}

export function drawStagingTrack(canvas: StagingCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx || !canvas._track) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  for (let x = 20; x < canvas.width; x += 30) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 20; y < canvas.height; y += 30) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
  const pS = stagingCoordToPx(canvas._track.subject);
  const pA = stagingCoordToPx(canvas._track.start);
  const pB = stagingCoordToPx(canvas._track.end);
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.beginPath();
  ctx.moveTo(pA.x, pA.y);
  ctx.lineTo(pS.x, pS.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(pB.x, pB.y);
  ctx.lineTo(pS.x, pS.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(pA.x, pA.y);
  ctx.lineTo(pB.x, pB.y);
  ctx.stroke();
  drawStagingPoint(ctx, pS, "#f59e0b", "S", canvas._hoverKey === "subject");
  drawStagingPoint(ctx, pA, "#3b82f6", "A", canvas._hoverKey === "start");
  drawStagingPoint(ctx, pB, "#10b981", "B", canvas._hoverKey === "end");
}

export function drawStagingPoint(
  ctx: CanvasRenderingContext2D,
  pt: StagingPoint,
  color: string,
  label: string,
  isHovered = false
): void {
  if (isHovered) {
    ctx.save();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, isHovered ? 11 : 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 10px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, pt.x, pt.y);
}

export function setupStagingEvents(canvas: StagingCanvasElement): () => void {
  let active: keyof StagingTrack | null = null;
  let windowListenersAttached = false;
  const HIT_RADIUS = 24;
  function getPos(e: MouseEvent | TouchEvent): StagingPoint {
    const rect = canvas.getBoundingClientRect();
    const touch = "touches" in e && e.touches.length ? e.touches[0] : null;
    const clientX = touch ? touch.clientX : (e as MouseEvent).clientX;
    const clientY = touch ? touch.clientY : (e as MouseEvent).clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }
  function findHitNode(pos: StagingPoint): keyof StagingTrack | null {
    if (!canvas._track) return null;
    const keys: (keyof StagingTrack)[] = ["subject", "start", "end"];
    for (const k of keys) {
      const pt = stagingCoordToPx(canvas._track[k]);
      if (Math.hypot(pos.x - pt.x, pos.y - pt.y) < HIT_RADIUS) {
        return k;
      }
    }
    return null;
  }
  function attachWindowDragListeners(): void {
    if (windowListenersAttached) return;
    windowListenersAttached = true;
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
  }
  function detachWindowDragListeners(): void {
    if (!windowListenersAttached) return;
    windowListenersAttached = false;
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onEnd);
    window.removeEventListener("touchmove", handleTouchMove);
    window.removeEventListener("touchend", onEnd);
    window.removeEventListener("touchcancel", onEnd);
  }
  function onStart(e: MouseEvent | TouchEvent): void {
    const pos = getPos(e);
    const hit = findHitNode(pos);
    if (hit) {
      active = hit;
      canvas._hoverKey = hit;
      canvas.style.cursor = "grabbing";
      attachWindowDragListeners();
      drawStagingTrack(canvas);
    }
  }
  function onHover(e: MouseEvent): void {
    if (active) return;
    const pos = getPos(e);
    const hit = findHitNode(pos);
    if (canvas._hoverKey !== hit) {
      canvas._hoverKey = hit;
      canvas.style.cursor = hit ? "grab" : "crosshair";
      drawStagingTrack(canvas);
    }
  }
  function onMove(e: MouseEvent | TouchEvent): void {
    if (!active || !canvas._track) return;
    e.preventDefault();
    const pos = getPos(e);
    canvas._track[active] = stagingPxToCoord(pos.x, pos.y);
    drawStagingTrack(canvas);
    updateStagingPreview(canvas);
  }
  function onEnd(): void {
    active = null;
    detachWindowDragListeners();
    canvas.style.cursor = canvas._hoverKey ? "grab" : "crosshair";
  }
  const handleTouchStart: EventListener = (e) => {
    onStart(e as TouchEvent);
  };
  const handleTouchMove: EventListener = (e) => {
    onMove(e as TouchEvent);
  };
  canvas.addEventListener("mousedown", onStart);
  canvas.addEventListener("mousemove", onHover);
  canvas.addEventListener("touchstart", handleTouchStart, { passive: false });

  return () => {
    active = null;
    detachWindowDragListeners();
    canvas.removeEventListener("mousedown", onStart);
    canvas.removeEventListener("mousemove", onHover);
    canvas.removeEventListener("touchstart", handleTouchStart);
  };
}

export function updateStagingPreview(canvas: StagingCanvasElement): void {
  const card = canvas.closest(".segment-card");
  if (!card) return;
  const previewEl = card.querySelector(".staging-preview-text");
  if (!previewEl) return;
  const text =
    typeof window.H3PromptBuilder !== "undefined" && window.H3PromptBuilder.compileCameraTrack
      ? window.H3PromptBuilder.compileCameraTrack(canvas._track)
      : "cinematic camera motion";
  previewEl.textContent = text;
}

export function setStagingPreset(btnEl: HTMLElement, presetKey: string): void {
  const card = btnEl.closest(".segment-card");
  const canvas = card ? card.querySelector<StagingCanvasElement>(".staging-canvas") : null;
  if (!canvas) return;
  if (!canvas._track) initStagingTrack(canvas);
  const presets: Record<string, StagingTrack> = {
    dolly_in: { start: { x: 0.0, y: 0.8 }, end: { x: 0.0, y: 0.25 }, subject: { x: 0.0, y: -0.1 } },
    pull_back: { start: { x: 0.0, y: 0.25 }, end: { x: 0.0, y: 0.85 }, subject: { x: 0.0, y: -0.1 } },
    orbit: { start: { x: -0.65, y: 0.4 }, end: { x: 0.65, y: 0.4 }, subject: { x: 0.0, y: 0.0 } },
    truck_right: { start: { x: -0.7, y: 0.4 }, end: { x: 0.7, y: 0.4 }, subject: { x: 0.0, y: -0.2 } },
  };
  if (presets[presetKey]) {
    canvas._track = JSON.parse(JSON.stringify(presets[presetKey]));
    drawStagingTrack(canvas);
    updateStagingPreview(canvas);
  }
}

export function applyStagingToCard(btnEl: HTMLElement): void {
  const card = btnEl.closest(".segment-card");
  if (!card) return;
  const previewEl = card.querySelector(".staging-preview-text");
  const camInput = card.querySelector<HTMLInputElement>(".ir-camera");
  if (!previewEl || !camInput) return;
  const camText = (previewEl.textContent || "").trim();
  if (!camText) {
    showToast("⚠️ 請先在軌跡板上拖曳機位或選擇預設");
    return;
  }
  camInput.value = camText;
  const promptEl = card.querySelector<HTMLTextAreaElement>(".seg-prompt-input");
  if (promptEl) {
    promptEl.value = updateSinglePromptSection(promptEl.value, "camera", camText);
  }
  syncSegmentsFromDOM();
  showToast("🎬 已將 2D 運鏡軌跡同步至 Camera 欄位與 Prompt");
}
