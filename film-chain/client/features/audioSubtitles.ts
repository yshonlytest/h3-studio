import type { DialogueTrackItem } from "../types/studio.ts";
import { getErrorMessage } from "../utils/errors.ts";
import { SHISA_DEFAULT_CONFIG } from "../data/templates.ts";
import { audioSubtitleStore } from "../stores/audioSubtitleStore.ts";
import { computeStore } from "../stores/computeStore.ts";
import { coreStore } from "../stores/coreStore.ts";
import { storyboardStore } from "../stores/storyboardStore.ts";
import { escapeHtml, playCompletionChime, showToast } from "./uiShell.ts";
import { rerollShotAudio } from "./phoneticsLexicon.ts";

export function syncDialogueItemsFromPlan(): void {
  const currentPlan = storyboardStore.getState().currentPlan;
  if (!currentPlan || !Array.isArray(currentPlan.segments)) return;
  const activeProjectMode = coreStore.getState().activeProjectMode;
  const existingItems = audioSubtitleStore.getState().currentDialogueItems;
  const segs = currentPlan.segments;
  const newItems: DialogueTrackItem[] = [];
  const isEdu = activeProjectMode === "edu" || currentPlan?.project_mode === "edu_explainer";
  let runningSec = 0;

  segs.forEach((seg, idx) => {
    const segDur = isEdu ? Math.round(((seg.frames || 124) / 24) * 10) / 10 : 5.0;
    const baseSec = isEdu ? Math.round(runningSec * 10) / 10 : idx * 5.0;
    runningSec += segDur;

    const extracted =
      typeof window.H3AudioStudio !== "undefined"
        ? window.H3AudioStudio.extractDialogueInfo(seg.prompt || "", idx)
        : { text: "", startOffsetSec: 1.5, durationSec: 2.5 };

    const dialogueText = seg.display_dialogue || seg.dialogue || extracted.text || "";
    const existing = existingItems[idx];
    const text = existing && existing.userEdited ? existing.text : dialogueText;

    const charCount = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf\w]/g) || []).length;
    const naturalDur =
      isEdu && charCount > 0
        ? Math.max(2.0, Math.min(segDur - 0.5, Math.round((charCount / 3.6 + 0.6) * 10) / 10))
        : extracted.durationSec;
    const naturalOffset = isEdu ? 0.2 : extracted.startOffsetSec;

    const finalBase = existing && typeof existing.baseSec === "number" ? existing.baseSec : baseSec;
    const finalDur = existing && typeof existing.durationSec === "number" ? existing.durationSec : naturalDur;
    const finalOffset = existing && typeof existing.startOffsetSec === "number" ? existing.startOffsetSec : naturalOffset;
    const finalSegDur = existing && typeof existing.segDurationSec === "number" ? existing.segDurationSec : segDur;

    newItems.push({
      partIndex: idx,
      partTitle: seg.title || `Part ${idx + 1}`,
      role: "角色",
      text,
      baseSec: finalBase,
      segDurationSec: finalSegDur,
      startOffsetSec: finalOffset,
      durationSec: finalDur,
      userEdited: existing ? existing.userEdited : false,
      audioBlobUrl: existing ? existing.audioBlobUrl : null,
    });
  });

  audioSubtitleStore.setDialogueItems(newItems);
  renderDialogueTrackList();
}

export function renderDialogueTrackList(): void {
  const container = document.getElementById("dialogueTrackList");
  if (!container) return;

  const currentDialogueItems = audioSubtitleStore.getState().currentDialogueItems;
  if (!currentDialogueItems.length) {
    container.innerHTML = '<div style="color:#64748b; font-size:0.82rem; padding:8px 0;">目前無分鏡台詞。請先於步驟一生成分鏡腳本。</div>';
    return;
  }

  container.innerHTML = currentDialogueItems
    .map((item, idx) => {
      const segSecStart = typeof item.baseSec === "number" ? item.baseSec : idx * 5;
      const segSecEnd = typeof item.segDurationSec === "number" ? Math.round((segSecStart + item.segDurationSec) * 10) / 10 : (idx + 1) * 5;
      const hasText = item.text && item.text.trim();

      return `
          <div style="background:#070d1a; border:1px solid #1e293b; border-radius:8px; padding:10px 14px; display:flex; flex-direction:column; gap:8px;">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
              <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                <span class="part-pill">Part ${idx + 1}</span>
                <span class="time-pill">⏱️ ${segSecStart} - ${segSecEnd}s</span>
                <span style="font-size:0.8rem; font-weight:600; color:#e2e8f0;">${escapeHtml(item.partTitle || "Part " + (idx + 1))}</span>
              </div>
              <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                <span style="font-size:0.74rem; color:#94a3b8;">起音時間：鏡段第</span>
                <input type="number" min="0" max="4.5" step="0.5" value="${Number(item.startOffsetSec) || 0}" style="width:62px; padding:3px 6px; font-size:0.76rem; background:#0f172a; border:1px solid #334155; border-radius:4px; color:#cbd5e1;" onchange="updateDialogueOffset(${idx}, this.value)" />
                <span style="font-size:0.74rem; color:#94a3b8;">秒</span>
                <button type="button" class="btn" style="padding:3px 10px; font-size:0.74rem; border-color:#10b981; color:#6ee7b7; background:rgba(16,185,129,0.12);" onclick="previewSingleDialogue(${idx})">
                  試聽
                </button>
                <button type="button" class="btn" style="padding:3px 10px; font-size:0.74rem; border-color:#38bdf8; color:#7dd3fc; background:rgba(56,189,248,0.12);" onclick="window.rerollShotAudio ? window.rerollShotAudio(${idx + 1}) : rerollShotAudio(${idx + 1})" title="調用 H3 代理畫布重抽 32kHz 音軌，保留原片聲紋與背景音樂">
                  重抽音軌
                </button>
              </div>
            </div>
            <div>
              <input type="text" value="${escapeHtml(item.text || "")}" placeholder="（本段暫無台詞，可自由輸入角色對白...）" style="width:100%; padding:6px 10px; font-size:0.84rem; background:#0c1322; border:1px solid ${hasText ? "#2563eb" : "#334155"}; border-radius:6px; color:#f8fafc;" oninput="updateDialogueText(${idx}, this.value)" />
            </div>
          </div>
        `;
    })
    .join("");
}

export function updateDialogueText(idx: number, val: string): void {
  const items = audioSubtitleStore.getState().currentDialogueItems;
  if (items[idx]) {
    const next = items.map((it, i) => (i === idx ? { ...it, text: val, userEdited: true } : it));
    audioSubtitleStore.setDialogueItems(next);
  }
}

export function updateDialogueOffset(idx: number, val: string): void {
  const items = audioSubtitleStore.getState().currentDialogueItems;
  if (items[idx]) {
    const offset = parseFloat(val) || 0;
    const clamped = Math.max(0, Math.min(4.5, offset));
    const next = items.map((it, i) => (i === idx ? { ...it, startOffsetSec: clamped, userEdited: true } : it));
    audioSubtitleStore.setDialogueItems(next);
  }
}

export function onTtsEngineChange(_val?: string): void {}

export async function previewSingleDialogue(idx: number): Promise<void> {
  const shotUrl = `outputs/shot_${idx + 1}.mp4`;
  try {
    const audio = new Audio(shotUrl);
    audio.currentTime = 0;
    await audio.play();
    showToast(`🔊 播放 Part ${idx + 1} 原片音訊...`);
  } catch (err) {
    console.debug("Preview dialogue audio unavailable:", err);
    showToast(`💡 Part ${idx + 1} 尚未產出音訊，請點選「重抽音軌」`);
  }
}

export async function applySingleDialogueToVideo(idx: number): Promise<void> {
  await rerollShotAudio(idx + 1);
}

export function onBgmStyleChange(val: string): void {
  const uploadBox = document.getElementById("customBgmUploadBox");
  if (uploadBox) {
    uploadBox.style.display = val === "custom" ? "block" : "none";
  }
  if (audioSubtitleStore.getState().isBgmPlaying) {
    void toggleBgmAudioPreview();
  }
}

export function updateBgmVolume(val: string | number): void {
  const label = document.getElementById("bgmVolumeLabel");
  if (label) label.textContent = `${val}%`;
  const { bgmGainNode, bgmAudioCtx } = audioSubtitleStore.getState();
  if (bgmGainNode && bgmAudioCtx) {
    const gain = (parseInt(String(val), 10) || 0) / 100;
    bgmGainNode.gain.setValueAtTime(gain, bgmAudioCtx.currentTime);
  }
}

export async function handleCustomBgmUpload(input: HTMLInputElement): Promise<void> {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  let actx: AudioContext | null = null;
  try {
    const arrayBuf = await file.arrayBuffer();
    const AudioCtx = window.AudioContext || window.webkitAudioContext!;
    actx = new AudioCtx();
    const decoded = await actx.decodeAudioData(arrayBuf);
    audioSubtitleStore.patchAudio({ customBgmAudioBuffer: decoded });
    showToast(`🎵 已載入自訂音樂檔: ${file.name} (${Math.round(decoded.duration)}秒)`);
  } catch (err: unknown) {
    showToast(`❌ 自訂音樂檔解碼失敗: ${getErrorMessage(err)}`);
  } finally {
    if (actx && typeof actx.close === "function") {
      await actx.close().catch((closeErr) => console.debug("Custom BGM AudioContext close skipped:", closeErr));
    }
  }
}

export async function toggleBgmAudioPreview(): Promise<void> {
  const btn = document.getElementById("previewBgmBtn");
  const st = audioSubtitleStore.getState();
  if (st.isBgmPlaying) {
    if (st.bgmAudioSource) {
      try {
        st.bgmAudioSource.stop();
      } catch (err) {
        console.debug("BGM stop warning:", err);
      }
    }
    audioSubtitleStore.patchAudio({ bgmAudioSource: null, isBgmPlaying: false });
    if (btn) btn.textContent = "試聽";
    return;
  }

  const style = (document.getElementById("bgmStyleSelect") as HTMLSelectElement | null)?.value || "fantasy";
  if (style === "none") {
    showToast("⚠️ 目前選擇為「無背景襯樂」");
    return;
  }

  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext!;
    const ctx = st.bgmAudioCtx || new AudioCtx();
    if (!st.bgmAudioCtx) {
      audioSubtitleStore.patchAudio({ bgmAudioCtx: ctx });
    }
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    let buffer: AudioBuffer | null = null;
    if (style === "custom") {
      buffer = st.customBgmAudioBuffer;
      if (!buffer) {
        showToast("⚠️ 請先選擇並上傳本地音樂檔案！");
        return;
      }
    } else if (typeof window.H3AudioStudio !== "undefined") {
      buffer = window.H3AudioStudio.generateProceduralBgmBuffer(ctx, style, 15);
    }

    if (!buffer) return;

    const gainNode = ctx.createGain();
    const vol = (parseInt((document.getElementById("bgmVolumeSlider") as HTMLInputElement | null)?.value || "35", 10) || 35) / 100;
    gainNode.gain.setValueAtTime(vol, ctx.currentTime);
    gainNode.connect(ctx.destination);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gainNode);
    source.start();

    audioSubtitleStore.patchAudio({
      bgmGainNode: gainNode,
      bgmAudioSource: source,
      isBgmPlaying: true,
    });
    if (btn) btn.textContent = "停止";
    showToast("🎶 正在試聽背景襯樂...");
  } catch (err: unknown) {
    showToast(`❌ 襯樂播放失敗: ${getErrorMessage(err)}`);
  }
}

export function downloadSubtitleFile(format: string): void {
  const currentDialogueItems = audioSubtitleStore.getState().currentDialogueItems;
  if (!currentDialogueItems.length) {
    showToast("⚠️ 目前沒有台詞可輸出字幕");
    return;
  }
  let content = "";
  const filename = `storyboard_subtitles.${format}`;
  if (format === "srt" && typeof window.H3AudioStudio !== "undefined") {
    content = window.H3AudioStudio.generateSrt(currentDialogueItems);
  } else if (format === "vtt" && typeof window.H3AudioStudio !== "undefined") {
    content = window.H3AudioStudio.generateVtt(currentDialogueItems);
  }
  if (!content) {
    showToast("⚠️ 尚無有效對白文字可導出字幕！");
    return;
  }

  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  showToast(`📄 已下載 ${filename}`);
}

export function toggleSoftSubtitleOverlay(checked: boolean): void {
  audioSubtitleStore.setSoftSubtitleEnabled(checked);
  const o1 = document.getElementById("playerSubtitleOverlay");
  const o2 = document.getElementById("masterSubtitleOverlay");
  if (!checked) {
    if (o1) o1.style.opacity = "0";
    if (o2) o2.style.opacity = "0";
  }
}

export function updatePlayerSoftSubtitle(timeSec: number): void {
  const { softSubtitleEnabled, currentDialogueItems } = audioSubtitleStore.getState();
  if (!softSubtitleEnabled || !currentDialogueItems.length) return;
  const o1 = document.getElementById("playerSubtitleOverlay");
  const t1 = document.getElementById("playerSubtitleText");
  const o2 = document.getElementById("masterSubtitleOverlay");
  const t2 = document.getElementById("masterSubtitleText");

  let activeText = "";
  for (let i = 0; i < currentDialogueItems.length; i++) {
    const item = currentDialogueItems[i];
    if (!item || !item.text || !item.text.trim()) continue;
    const base = typeof item.baseSec === "number" ? item.baseSec : (item.partIndex || i) * 5.0;
    const segDur = typeof item.segDurationSec === "number" ? item.segDurationSec : 5.0;
    const offset = typeof item.startOffsetSec === "number" ? item.startOffsetSec : 0.5;
    const dur = typeof item.durationSec === "number" ? item.durationSec : Math.max(2.0, segDur - offset - 0.2);
    const start = base + offset;
    const end = Math.min(base + segDur, start + dur);
    if (timeSec >= start && timeSec <= end) {
      activeText = item.text.trim();
      break;
    }
  }

  if (activeText) {
    if (t1) t1.textContent = activeText;
    if (o1) o1.style.opacity = "1";
    if (t2) t2.textContent = activeText;
    if (o2) o2.style.opacity = "1";
  } else {
    if (o1) o1.style.opacity = "0";
    if (o2) o2.style.opacity = "0";
  }
}

async function renderMixedAudioTrack(options: {
  currentDialogueItems: DialogueTrackItem[];
  customBgmAudioBuffer: AudioBuffer | null;
  onProgress: (pct: number, stage?: string, log?: string) => void;
}): Promise<AudioBuffer> {
  const { currentDialogueItems, customBgmAudioBuffer, onProgress } = options;
  const AudioCtx = window.AudioContext || window.webkitAudioContext!;
  const audioCtx = new AudioCtx();
  try {
    const sampleRate = audioCtx.sampleRate;
    const totalDurationSec =
      currentDialogueItems.reduce((acc, it) => acc + (typeof it.segDurationSec === "number" ? it.segDurationSec : 5.0), 0) ||
      Math.max(5, currentDialogueItems.length * 5);

    const bgmStyle = (document.getElementById("bgmStyleSelect") as HTMLSelectElement | null)?.value || "fantasy";
    let bgmBuffer: AudioBuffer | null = null;
    if (bgmStyle === "custom" && customBgmAudioBuffer) {
      bgmBuffer = customBgmAudioBuffer;
    } else if (bgmStyle !== "none" && typeof window.H3AudioStudio !== "undefined") {
      bgmBuffer = window.H3AudioStudio.generateProceduralBgmBuffer(audioCtx, bgmStyle, totalDurationSec);
    }

    onProgress(30, undefined, "載入各鏡原片音訊軌...");

    const dialogueBuffers: Array<{ item: DialogueTrackItem; buffer: AudioBuffer; time: number }> = [];
    for (let i = 0; i < currentDialogueItems.length; i++) {
      const item = currentDialogueItems[i];
      let buf: AudioBuffer | null = null;
      try {
        const res = await fetch(`outputs/shot_${i + 1}.mp4`);
        if (res.ok) {
          const arrayBuf = await res.arrayBuffer();
          buf = await audioCtx.decodeAudioData(arrayBuf);
        }
      } catch (err) {
        console.debug(`Shot ${i + 1} audio decode skipped:`, err);
      }

      if (buf) {
        dialogueBuffers.push({
          item,
          buffer: buf,
          time: i * 5,
        });
      }
    }

    onProgress(50, "🎚️ 正在多軌渲染 (對白 + 閃避 Ducking 襯樂)...", "運算雙耳立體聲混音軌...");

    const offlineCtx = new OfflineAudioContext(2, Math.floor(sampleRate * totalDurationSec), sampleRate);

    if (bgmBuffer) {
      const bgmSource = offlineCtx.createBufferSource();
      bgmSource.buffer = bgmBuffer;
      bgmSource.loop = true;

      const bgmGain = offlineCtx.createGain();
      const baseVol = (parseInt((document.getElementById("bgmVolumeSlider") as HTMLInputElement | null)?.value || "35", 10) || 35) / 100;
      bgmGain.gain.setValueAtTime(baseVol, 0);

      const duckingEnabled = (document.getElementById("audioDuckingCheck") as HTMLInputElement | null)?.checked ?? true;
      if (duckingEnabled && typeof window.H3AudioStudio !== "undefined") {
        const duckingRanges = window.H3AudioStudio.calculateDuckingRanges(currentDialogueItems);
        duckingRanges.forEach((range: { start: number; end: number }) => {
          const duckVol = Math.max(0.05, baseVol * 0.25);
          bgmGain.gain.setValueAtTime(baseVol, Math.max(0, range.start - 0.2));
          bgmGain.gain.linearRampToValueAtTime(duckVol, range.start);
          bgmGain.gain.setValueAtTime(duckVol, range.end);
          bgmGain.gain.linearRampToValueAtTime(baseVol, range.end + 0.3);
        });
      }

      bgmSource.connect(bgmGain);
      bgmGain.connect(offlineCtx.destination);
      bgmSource.start(0);
    }

    dialogueBuffers.forEach((d) => {
      const dSource = offlineCtx.createBufferSource();
      dSource.buffer = d.buffer;
      const dGain = offlineCtx.createGain();
      dGain.gain.setValueAtTime(1.0, 0);
      dSource.connect(dGain);
      dGain.connect(offlineCtx.destination);
      dSource.start(d.time);
    });

    return await offlineCtx.startRendering();
  } finally {
    if (typeof audioCtx.close === "function") {
      await audioCtx.close().catch((closeErr) => console.debug("Offline decode AudioContext close skipped:", closeErr));
    }
  }
}

function drawBurnInSubtitleOnCanvas(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  currentDialogueItems: ReadonlyArray<DialogueTrackItem>,
  curTime: number
): void {
  if (!currentDialogueItems.length) return;
  let sub = "";
  for (let i = 0; i < currentDialogueItems.length; i++) {
    const it = currentDialogueItems[i];
    if (!it || !it.text || !it.text.trim()) continue;
    const start = (it.partIndex || i) * 5 + (it.startOffsetSec || 1.5);
    const end = Math.min(((it.partIndex || i) + 1) * 5, start + (it.durationSec || 2.5));
    if (curTime >= start && curTime <= end) {
      sub = it.text.trim();
      break;
    }
  }
  if (!sub) return;

  ctx.save();
  ctx.font = "bold 20px 'Segoe UI', system-ui, sans-serif";
  const textWidth = ctx.measureText(sub).width;
  const boxPadX = 16;
  const boxHeight = 36;
  const boxX = (canvas.width - textWidth - boxPadX * 2) / 2;
  const boxY = canvas.height - 56;

  ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
  ctx.fillRect(boxX, boxY, textWidth + boxPadX * 2, boxHeight);

  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(0,0,0,0.9)";
  ctx.shadowBlur = 4;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(sub, canvas.width / 2, boxY + boxHeight / 2);
  ctx.restore();
}

export async function executeMasterAudioVideoMux(): Promise<void> {
  const currentPlaylist = computeStore.getState().currentPlaylist;
  const currentPlan = storyboardStore.getState().currentPlan;
  const { currentDialogueItems, customBgmAudioBuffer } = audioSubtitleStore.getState();

  const sourceVideoUrl =
    (document.getElementById("mainVideoPlayer") as HTMLVideoElement | null)?.src ||
    (currentPlaylist[0] ? currentPlaylist[0].url : "") ||
    SHISA_DEFAULT_CONFIG.merged_video_path;

  if (!sourceVideoUrl) {
    showToast("⚠️ 尚未載入或生成任何基礎影片！請先完成步驟三或四。");
    return;
  }

  const mixBtn = document.getElementById("masterMixBtn") as HTMLButtonElement | null;
  const progressBox = document.getElementById("masterMuxProgressBox");
  const progressBar = document.getElementById("masterMuxProgressBar");
  const stageText = document.getElementById("masterMuxStageText");
  const percentText = document.getElementById("masterMuxPercentText");
  const logText = document.getElementById("masterMuxLogText");

  const setProgress = (pct: number, stageMsg?: string, logMsg?: string): void => {
    if (progressBar) progressBar.style.width = `${pct}%`;
    if (percentText) percentText.textContent = `${pct}%`;
    if (stageMsg && stageText) stageText.textContent = stageMsg;
    if (logMsg && logText) logText.textContent = logMsg;
  };

  if (mixBtn) mixBtn.disabled = true;
  if (progressBox) progressBox.style.display = "block";
  setProgress(10, "🎙️ 正在準備角色台詞語音與音樂軌...", "初始化 Web Audio 混音工作空間...");

  let realAudioCtx: AudioContext | null = null;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext!;
    const mixedAudioBuffer = await renderMixedAudioTrack({
      currentDialogueItems,
      customBgmAudioBuffer,
      onProgress: setProgress,
    });

    setProgress(75, "🎬 正在將影片、混音軌與動態字幕合為一體...", "啟動端側極速封裝引擎...");

    const burnIn = (document.getElementById("burnInSubtitleCheck") as HTMLInputElement | null)?.checked ?? false;
    const v = document.createElement("video");
    v.crossOrigin = "anonymous";
    v.playsInline = true;
    v.muted = true;
    v.src = sourceVideoUrl;
    await new Promise<void>((resolve, reject) => {
      v.onloadedmetadata = () => resolve();
      v.onerror = () => reject(new Error("基礎影片載入失敗，無法完成合成"));
    });

    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth || 640;
    canvas.height = v.videoHeight || 480;
    const ctx = canvas.getContext("2d")!;

    realAudioCtx = new AudioCtx();
    const audioDest = realAudioCtx.createMediaStreamDestination();
    const masterSource = realAudioCtx.createBufferSource();
    masterSource.buffer = mixedAudioBuffer;
    masterSource.connect(audioDest);

    const canvasStream = canvas.captureStream(30);
    const audioTrack = audioDest.stream.getAudioTracks()[0];
    if (audioTrack) {
      canvasStream.addTrack(audioTrack);
    }

    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : MediaRecorder.isTypeSupported("video/mp4")
        ? "video/mp4"
        : "video/webm";

    const recorder = new MediaRecorder(canvasStream, { mimeType: mime });
    const recordedChunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };

    const renderCompletePromise = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });

    recorder.start();
    masterSource.start(0);
    await v.play();

    const drawLoop = (): void => {
      if (v.paused || v.ended) return;
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      if (burnIn) {
        drawBurnInSubtitleOnCanvas(ctx, canvas, currentDialogueItems, v.currentTime);
      }
      requestAnimationFrame(drawLoop);
    };
    requestAnimationFrame(drawLoop);

    await new Promise<void>((res) => {
      v.onended = () => res();
    });

    recorder.stop();
    await renderCompletePromise;
    try {
      masterSource.stop();
    } catch (err) {
      console.debug("Master source stop warning:", err);
    }

    const finalBlob = new Blob(recordedChunks, { type: mime });
    const finalUrl = URL.createObjectURL(finalBlob);

    setProgress(100, "🎉 廣播級成片合成成功！", "音畫合一已就緒，可立即預覽與下載。");

    const stage = document.getElementById("masterFinalVideoStage");
    const masterPlayer = document.getElementById("masterFinalVideoPlayer") as HTMLVideoElement | null;
    const dlBtn = document.getElementById("downloadMasterVideoBtn") as HTMLAnchorElement | null;

    if (stage) stage.style.display = "block";
    if (masterPlayer) {
      masterPlayer.src = finalUrl;
      masterPlayer.load();
      masterPlayer.play().catch((err) => console.debug("Master player autoplay skipped:", err));
    }

    if (dlBtn) {
      dlBtn.href = finalUrl;
      dlBtn.download = `filmchain_${currentPlan?.project_slug || "storyboard"}_cinematic_master.${mime.includes("mp4") ? "mp4" : "webm"}`;
    }

    showToast("🌟 恭喜！廣播級完整影視成片已合成完畢！");
    playCompletionChime();
    if (stage) stage.scrollIntoView({ behavior: "smooth" });
  } catch (err: unknown) {
    const msg = getErrorMessage(err);
    showToast(`❌ 合成成片失敗: ${msg}`);
    if (stageText) stageText.textContent = "❌ 合成中斷";
    if (logText) logText.textContent = msg;
  } finally {
    if (realAudioCtx && typeof realAudioCtx.close === "function") {
      await realAudioCtx.close().catch((closeErr) => console.debug("Real AudioContext close skipped:", closeErr));
    }
    if (mixBtn) mixBtn.disabled = false;
  }
}
