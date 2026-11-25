import type { PlaylistItem, StoryboardSegment } from "../types/studio.ts";
import { LOCAL_DAEMON_BASE_URL } from "../config/constants.ts";
import { sanitizeUrl } from "../utils/domSafety.ts";
import { formatDiagnosticError, getErrorMessage } from "../utils/errors.ts";
import { computeStore } from "../stores/computeStore.ts";
import { storyboardStore } from "../stores/storyboardStore.ts";
import { escapeHtml, getPrefs, playCompletionChime, showToast } from "./uiShell.ts";
import { getOrCreateSessionId, startSessionListener } from "./sessionColab.ts";
import { syncSegmentsFromDOM } from "./storyboardEditor.ts";
import { showCostConfirmDialog } from "./dispatchCloudApi.ts";
import { rerollShotAudio } from "./phoneticsLexicon.ts";

interface SegmentVersionEntry {
  version: number;
  url: string;
  prompt: string;
  panel: number;
  seed?: number;
}

export function playPlaylistItem(idx: number): void {
  const safeIdx = Math.trunc(idx);
  const item = computeStore.getState().currentPlaylist[safeIdx];
  if (!item) return;
  playVideoInStage(item.url, item.title || `Part ${safeIdx + 1}`);
}

export function playVideoInStage(
  url: string,
  labelText: string,
  autoPlay = true,
  seekToTime: number | null = null
): void {
  const player = document.getElementById("mainVideoPlayer") as HTMLVideoElement | null;
  if (!player) return;
  player.src = url;
  player.load();
  if (seekToTime !== null && typeof seekToTime === "number") {
    player.onloadedmetadata = () => {
      player.currentTime = Math.max(0, seekToTime);
      if (autoPlay) {
        player.play().catch((err) => console.debug("Video autoplay skipped:", err));
      }
    };
  } else if (autoPlay) {
    player.play().catch((err) => console.debug("Video autoplay skipped:", err));
  }
  const labelEl = document.getElementById("currentVideoLabel");
  if (labelEl) labelEl.textContent = labelText;
  const dl = document.getElementById("downloadVideoBtn") as HTMLAnchorElement | null;
  if (dl) {
    dl.href = url;
    dl.style.display = "inline-flex";
  }
  const driveBtn = document.getElementById("saveMainToDriveBtn");
  if (driveBtn) driveBtn.style.display = "inline-flex";
}

export async function saveVideoToGoogleDrive(target = "main"): Promise<void> {
  const player = document.getElementById(
    target === "master" ? "masterFinalVideoPlayer" : "mainVideoPlayer"
  ) as HTMLVideoElement | null;
  const src = player ? player.getAttribute("src") || player.src : "";
  if (!src) {
    showToast("⚠️ 尚未載入可儲存的影片！");
    return;
  }
  computeStore.patchCompute({ pendingCloudSaveTarget: target });
  const daemonBtn = document.getElementById("cloudSaveDaemonOptionBtn");
  if (daemonBtn) {
    const envApi = window.H3LocalEnv;
    const isOnline = envApi && envApi.checkNow ? Boolean(await envApi.checkNow()) : false;
    daemonBtn.style.display = isOnline ? "flex" : "none";
  }
  const dialog = document.getElementById("cloudDriveSaveDialog") as HTMLDialogElement | null;
  if (dialog) dialog.showModal();
}

export async function executeCloudSaveOption(mode: string): Promise<void> {
  const dialog = document.getElementById("cloudDriveSaveDialog") as HTMLDialogElement | null;
  if (dialog && dialog.open) dialog.close();

  const target = computeStore.getState().pendingCloudSaveTarget || "main";
  const player = document.getElementById(
    target === "master" ? "masterFinalVideoPlayer" : "mainVideoPlayer"
  ) as HTMLVideoElement | null;
  const src = player ? player.getAttribute("src") || player.src : "";
  if (!src) {
    showToast("⚠️ 尚未載入可儲存的影片！");
    return;
  }

  const btn = document.getElementById(
    target === "master" ? "saveMasterToDriveBtn" : "saveMainToDriveBtn"
  ) as HTMLButtonElement | null;
  const origText = btn ? btn.textContent || "☁️ 儲存到雲端硬碟" : "☁️ 儲存到雲端硬碟";
  if (btn) {
    btn.disabled = true;
    btn.textContent = "⏳ 處理中...";
  }

  try {
    const videoRes = await fetch(src);
    if (!videoRes.ok) throw new Error(`讀取影片失敗 (${videoRes.status})`);
    const blob = await videoRes.blob();
    const currentPlan = storyboardStore.getState().currentPlan;
    const slug = (currentPlan?.project_slug || "h3_story").replace(/[^a-zA-Z0-9_-]/g, "_");
    const ext = blob.type && blob.type.includes("webm") ? "webm" : "mp4";
    const mimeType = ext === "webm" ? "video/webm" : "video/mp4";
    const filename = `${slug}_${target === "master" ? "master" : "merged"}.${ext}`;

    if (mode === "picker") {
      if (typeof window.showSaveFilePicker === "function") {
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [
            {
              description: "Video File",
              accept: { [mimeType]: [`.${ext}`] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        showToast(`✅ 已成功儲存「${filename}」至您選定的雲端資料夾！`);
        return;
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      showToast(`📥 您的瀏覽器不支援直接選取資料夾，已為您下載「${filename}」`);
      return;
    }

    if (mode === "share") {
      const fileObj = new File([blob], filename, { type: mimeType });
      if (navigator.canShare && navigator.canShare({ files: [fileObj] })) {
        await navigator.share({
          title: filename,
          text: "H3 Storyboard Studio 影片成片",
          files: [fileObj],
        });
        showToast("✅ 已透過系統分享選單傳送影片！");
        return;
      }
      showToast("💡 此瀏覽器不支援系統檔案分享，已自動改用「另存新檔」視窗");
      if (typeof window.showSaveFilePicker === "function") {
        await executeCloudSaveOption("picker");
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
      }
      return;
    }

    if (mode === "daemon") {
      const upRes = await fetch(
        `${LOCAL_DAEMON_BASE_URL}/api/gdrive/upload?filename=${encodeURIComponent(filename)}&folder=H3-Studio`,
        {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: blob,
        }
      );
      const data = await upRes.json();
      if (!upRes.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${upRes.status}`);
      }
      showToast(`✅ 已備份至 Google Drive「H3-Studio」資料夾！${data.web_url ? "（已開啟連結）" : ""}`);
      if (data.web_url) {
        window.open(data.web_url, "_blank");
      }
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      showToast("ℹ️ 已取消儲存");
    } else {
      showToast(`❌ 雲端硬碟儲存失敗：${getErrorMessage(err)}`);
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = origText;
    }
  }
}

export function toggleSeamlessPlayback(): void {
  const currentPlaylist = computeStore.getState().currentPlaylist;
  if (!currentPlaylist.length) return;
  computeStore.setSeamlessPlayback(true, 0);
  const btn = document.getElementById("seamlessPlayBtn");
  if (btn) btn.textContent = "⏸️ 正在無縫全片連播中...";
  playVideoInStage(currentPlaylist[0].url, `▶️ 連播中 (第 1/${currentPlaylist.length} 段)：${currentPlaylist[0].title}`);
}

export async function mergeAndDownloadCloudClips(
  autoDownload = true,
  seekTime: number | null = null
): Promise<string | undefined> {
  const currentPlaylist = computeStore.getState().currentPlaylist;
  const currentPlan = storyboardStore.getState().currentPlan;

  if (!currentPlaylist.length) {
    showToast("⚠️ 目前沒有分段影片清單可合併");
    return undefined;
  }
  if (currentPlaylist.length === 1 || currentPlaylist[0].title.includes("完整合併總影片")) {
    if (autoDownload) {
      const a = document.createElement("a");
      a.href = currentPlaylist[0].url;
      const dlSlug = currentPlan?.project_slug || "story";
      a.download = `${dlSlug}_${currentPlan?.recommended_total_seconds || 15}s_merged.mp4`;
      a.click();
    }
    return undefined;
  }

  const btn = document.getElementById("browserMergeBtn") as HTMLButtonElement | null;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "⏳ 正在前端記憶體串接錄製中...";
  }

  const statusBox = document.getElementById("jobStageText");
  const panelEl = document.getElementById("jobProgressPanel");
  const barEl = document.getElementById("jobProgressBar");
  if (panelEl) panelEl.style.display = "block";
  if (barEl) barEl.style.width = "20%";

  try {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext("2d")!;
    const stream = canvas.captureStream(30);

    const mediaRecorder = new MediaRecorder(stream, {
      mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm",
    });

    const chunks: Blob[] = [];
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    const recordPromise = new Promise<Blob>((resolve) => {
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: "video/webm" });
        resolve(blob);
      };
    });

    mediaRecorder.start();

    const hiddenVid = document.createElement("video");
    hiddenVid.crossOrigin = "anonymous";
    hiddenVid.muted = true;
    hiddenVid.playsInline = true;

    for (let i = 0; i < currentPlaylist.length; i++) {
      const clip = currentPlaylist[i];
      if (statusBox) statusBox.textContent = `🎬 前端正在依序串接第 ${i + 1}/${currentPlaylist.length} 段 (${clip.title})...`;
      if (barEl) barEl.style.width = `${Math.round(((i + 0.5) / currentPlaylist.length) * 100)}%`;

      await new Promise<void>((resolve) => {
        hiddenVid.src = clip.url;
        hiddenVid.onloadeddata = async () => {
          try {
            await hiddenVid.play();
            const drawInterval = setInterval(() => {
              if (hiddenVid.paused || hiddenVid.ended) {
                clearInterval(drawInterval);
                resolve();
              } else {
                ctx.drawImage(hiddenVid, 0, 0, canvas.width, canvas.height);
              }
            }, 1000 / 30);
          } catch (err) {
            console.debug("Hidden video play skipped:", err);
            resolve();
          }
        };
        hiddenVid.onerror = () => resolve();
      });
    }

    mediaRecorder.stop();
    const finalBlob = await recordPromise;
    const finalUrl = URL.createObjectURL(finalBlob);

    if (barEl) barEl.style.width = "100%";
    if (statusBox) statusBox.textContent = "✅ 前端純網頁串接合併完成！已自動就緒。";

    if (autoDownload) {
      const a = document.createElement("a");
      a.href = finalUrl;
      a.download = `merged_${currentPlan?.project_slug || "storyboard"}_full.webm`;
      a.click();
    }

    const sid = getOrCreateSessionId();
    fetch(`/api/session/${sid}/video`, {
      method: "POST",
      headers: { "Content-Type": "video/webm" },
      body: finalBlob,
    }).catch((err) => console.debug("Merged video session upload skipped:", err));

    playVideoInStage(finalUrl, "🎬 前端無縫合併完成品", true, seekTime);
    return finalUrl;
  } catch (err: unknown) {
    showToast(`❌ 前端合併失敗：${getErrorMessage(err)}`);
    return undefined;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "🎬 純前端一鍵合併 MP4";
    }
  }
}

export function toggleRerollDrawer(idx: number, btn?: HTMLElement | null): void {
  const drawer = document.getElementById(`reroll-drawer-${idx}`);
  if (!drawer) return;
  const isHidden = drawer.style.display === "none";
  drawer.style.display = isHidden ? "block" : "none";
  const targetBtn = btn || document.getElementById(`btn-toggle-drawer-${idx}`);
  if (targetBtn) {
    targetBtn.textContent = isHidden ? "微調 ▴" : "微調 ▾";
  }
}

export function randomizeRerollSeed(idx: number): void {
  const input = document.getElementById(`reroll-seed-${idx}`) as HTMLInputElement | null;
  if (input) {
    input.value = String(Math.floor(Math.random() * 89999999 + 10000000));
  }
}

export async function switchSegmentVersion(idx: number, verIndex: number): Promise<void> {
  const { segmentHistory, activeVersionIndex, currentPlaylist } = computeStore.getState();
  const versions = (segmentHistory[idx] || []) as SegmentVersionEntry[];
  const target = versions[verIndex];
  if (!target) return;

  const nextActiveVer = { ...activeVersionIndex, [idx]: verIndex };
  const nextPlaylist = currentPlaylist.map((item, i) => (i === idx ? { ...item, url: target.url } : item));
  computeStore.patchCompute({ activeVersionIndex: nextActiveVer, currentPlaylist: nextPlaylist });

  const currentPlan = storyboardStore.getState().currentPlan;
  if (currentPlan && currentPlan.segments && currentPlan.segments[idx]) {
    storyboardStore.updateSegmentAt(idx, { prompt: target.prompt, end_panel: target.panel });
  }
  renderSegmentsPlaylist(nextPlaylist);
  showToast(`🔄 已切換為 Part ${idx + 1} v${verIndex + 1}，正在重新縫合全片...`);
  await mergeAndDownloadCloudClips(false, Math.max(0, idx * 5 - 1.5));
}

interface RerollParams {
  idx: number;
  mode: string;
  promptText: string;
  panel: number;
  seed: number;
  segs: StoryboardSegment[];
}

async function dispatchColabReroll(params: RerollParams): Promise<void> {
  const { idx, mode, promptText, panel, seed } = params;
  const sid = getOrCreateSessionId();
  showToast(`🚀 正在向雲端中繼下發 Part ${idx + 1} 重抽任務 (${mode === "single" ? "單段" : "連鎖"})...`);
  const rerollTarget = {
    part_index: idx + 1,
    mode,
    prompt: promptText,
    end_panel: panel,
    seed,
    cascade: mode === "cascade",
  };

  try {
    await fetch(`/api/session/${sid}/manifest`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reroll_target: rerollTarget }),
    });

    const renderCard = document.getElementById(`stage-card-part-${idx + 1}`);
    if (renderCard) {
      renderCard.className = "pipeline-step-card stage-render active-running";
      const timeEl = renderCard.querySelector(".pipeline-step-time");
      if (timeEl) timeEl.textContent = "重抽推論中...";
    }

    startSessionListener(sid);
    const cmd = `python3 -m pipeline.h3_cli run --route colab --session-id ${sid} --reroll ${idx + 1}${mode === "cascade" ? " --cascade" : ""}`;
    const ta = document.getElementById("colabPromptTextarea") as HTMLTextAreaElement | null;
    if (ta) ta.value = cmd;

    showToast(`✅ Part ${idx + 1} 重抽已下發！已更新終端指令，Colab 將自動接單。`);
    document.getElementById("step3Card")?.scrollIntoView({ behavior: "smooth" });
  } catch (err: unknown) {
    showToast(`❌ 發布重抽任務失敗: ${getErrorMessage(err)}`);
  }
}

async function dispatchCloudApiReroll(params: RerollParams): Promise<void> {
  const { idx, mode, promptText, panel, seed, segs } = params;
  const select = document.getElementById("cloudProviderSelect") as HTMLSelectElement | null;
  const providerVal = select ? select.value : "fal-hailuo";
  const p = getPrefs();
  const provider = providerVal.startsWith("minimax") ? "minimax" : "fal";
  const apiKey = provider === "minimax" ? p.minimaxKey : p.falKey;

  if (!apiKey) {
    showToast("⚠️ 請先填入對應的雲端 API Key！");
    return;
  }

  const startIdx = idx;
  const endIdx = mode === "cascade" ? segs.length - 1 : idx;
  const count = endIdx - startIdx + 1;

  const costEst =
    typeof window.H3CloudApiAdapter !== "undefined"
      ? window.H3CloudApiAdapter.estimateCost(provider, count)
      : { desc: "依調用量計費" };

  const confirmed = await showCostConfirmDialog({
    message: `即將發起 Part ${idx + 1} 雲端重抽任務 (${mode === "cascade" ? "連鎖重跑" : "僅本段"})。`,
    estimateText: costEst.desc,
  });
  if (!confirmed) return;

  const drawer = document.getElementById(`reroll-drawer-${idx}`);
  if (drawer) drawer.style.display = "none";

  showToast(`⚡ 正在發起 Part ${idx + 1} 雲端重抽任務...`);

  try {
    const client = provider === "minimax" ? window.H3CloudApiAdapter!.MiniMaxClient : window.H3CloudApiAdapter!.FalClient;
    const { slicedPanelsDataUrls, gridImageDataUrl } = storyboardStore.getState();
    const st = computeStore.getState();

    let prevFrame = "";
    if (idx === 0) {
      prevFrame = slicedPanelsDataUrls[1] || gridImageDataUrl || "";
    } else {
      const prevVid = st.currentPlaylist[idx - 1]?.url;
      if (prevVid) {
        prevFrame = await window.H3CloudApiAdapter!.extractLastFrameFromVideo(prevVid).catch(() => "");
      }
      if (!prevFrame) {
        prevFrame = slicedPanelsDataUrls[segs[idx - 1]?.end_panel || 3] || "";
      }
    }

    const nextHistory = { ...st.segmentHistory };
    const nextActiveVer = { ...st.activeVersionIndex };
    const nextPlaylist = [...st.currentPlaylist];

    for (let i = startIdx; i <= endIdx; i++) {
      const curPrompt = i === idx ? promptText : segs[i].prompt;
      const curPanel = i === idx ? panel : segs[i].end_panel || 9;

      showToast(`🎨 正在雲端算力中渲染 Part ${i + 1}...`);
      const subRes = await client.submitTask({ apiKey, prompt: curPrompt, firstFrameUrl: prevFrame });

      let newUrl = "";
      if (subRes.direct) {
        newUrl = subRes.videoUrl;
      } else {
        const pollRes = await client.pollTask({
          apiKey,
          requestId: subRes.requestId,
          taskId: subRes.taskId,
        });
        newUrl = pollRes.videoUrl;
      }

      const histList = [...((nextHistory[i] || []) as SegmentVersionEntry[])];
      const newVer = histList.length + 1;
      histList.push({
        version: newVer,
        url: newUrl,
        prompt: curPrompt,
        panel: curPanel,
        seed,
      });
      nextHistory[i] = histList;
      nextActiveVer[i] = histList.length - 1;
      nextPlaylist[i] = { ...(nextPlaylist[i] || { title: segs[i]?.title || `Part ${i + 1}`, url: newUrl }), url: newUrl };

      if (i < endIdx) {
        try {
          prevFrame = await window.H3CloudApiAdapter!.extractLastFrameFromVideo(newUrl);
        } catch (err) {
          console.debug("Extract last frame fallback:", err);
          prevFrame = slicedPanelsDataUrls[curPanel] || prevFrame;
        }
      }
    }

    computeStore.patchCompute({
      segmentHistory: nextHistory,
      activeVersionIndex: nextActiveVer,
      currentPlaylist: nextPlaylist,
    });

    renderSegmentsPlaylist(nextPlaylist);
    showToast(`🎉 Part ${idx + 1} 重抽完成！正在重新縫合全片...`);
    await mergeAndDownloadCloudClips(false, Math.max(0, idx * 5 - 1.5));
    playCompletionChime();
  } catch (err: unknown) {
    showToast(`❌ 雲端重抽失敗: ${formatDiagnosticError(err, provider).plainText}`);
  }
}

export async function triggerRerollExecution(idx: number, mode: string): Promise<void> {
  const promptEl = document.getElementById(`reroll-prompt-${idx}`) as HTMLTextAreaElement | null;
  const panelEl = document.getElementById(`reroll-panel-${idx}`) as HTMLSelectElement | null;
  const seedEl = document.getElementById(`reroll-seed-${idx}`) as HTMLInputElement | null;
  const promptText = promptEl ? promptEl.value.trim() : "";
  const panel = panelEl ? parseInt(panelEl.value, 10) : 9;
  const seed = seedEl ? parseInt(seedEl.value, 10) : 20260931 + idx;

  if (!promptText) {
    showToast("⚠️ 請輸入重抽提示詞！");
    return;
  }

  const currentPlan = storyboardStore.getState().currentPlan;
  if (currentPlan && currentPlan.segments && currentPlan.segments[idx]) {
    storyboardStore.updateSegmentAt(idx, { prompt: promptText, end_panel: panel });
  }

  const segs = syncSegmentsFromDOM();
  const activeRoute = computeStore.getState().activeRoute;
  const params: RerollParams = { idx, mode, promptText, panel, seed, segs };

  if (activeRoute === "colab") {
    await dispatchColabReroll(params);
  } else if (activeRoute === "saas_api") {
    await dispatchCloudApiReroll(params);
  } else {
    showToast("💡 本地模式請於步驟三重新啟動渲染任務");
  }
}

export function renderSegmentsPlaylist(items: PlaylistItem[]): void {
  const playlist = items || [];
  computeStore.setPlaylist(playlist);

  const box = document.getElementById("cloudSegmentsPlaylistBox");
  const list = document.getElementById("cloudClipsList");
  if (!box || !list) return;
  box.style.display = "block";
  list.innerHTML = "";

  const b4 = document.getElementById("step4SegmentsBadge");
  if (b4 && playlist.length > 0) {
    b4.textContent = `共 ${playlist.length} 段個別影片 ＋ 1 支完整彙整總片`;
  }

  const segs = syncSegmentsFromDOM();
  const currentPlan = storyboardStore.getState().currentPlan;
  const st = computeStore.getState();
  const nextHistory = { ...st.segmentHistory };
  const nextActiveVer = { ...st.activeVersionIndex };
  let historyMutated = false;

  playlist.forEach((item, idx) => {
    const seg = segs[idx] || (currentPlan?.segments ? currentPlan.segments[idx] : null);
    const promptVal = seg ? seg.prompt : "";
    const panelVal = seg ? seg.end_panel || 9 : 9;

    if (!nextHistory[idx]) {
      nextHistory[idx] = [{ version: 1, url: item.url, prompt: promptVal, panel: panelVal, seed: 20260931 + idx }];
      nextActiveVer[idx] = 0;
      historyMutated = true;
    }

    const vers = nextHistory[idx] as SegmentVersionEntry[];
    const curVerIdx = nextActiveVer[idx] || 0;
    const activeVer = curVerIdx + 1;
    const totalVers = vers.length;

    const safeIdx = Math.trunc(idx);
    const safeUrl = sanitizeUrl(item.url, { allowBlob: true, allowRelative: true });

    let versionsHtml = "";
    vers.forEach((v, vIdx) => {
      const safeVerIdx = Math.trunc(vIdx);
      const isAct = safeVerIdx === curVerIdx;
      versionsHtml += `
            <button type="button" class="btn" style="padding:2px 8px; font-size:0.72rem; ${isAct ? "border-color:#38bdf8; background:rgba(56,189,248,0.25); color:#7dd3fc; font-weight:700;" : "background:#0b1322; color:#94a3b8;"}" onclick="switchSegmentVersion(${safeIdx}, ${safeVerIdx})">
              v${Number(v.version) || safeVerIdx + 1}${isAct ? " (使用中)" : ""}
            </button>
          `;
    });

    const row = document.createElement("div");
    row.className = "cloud-clip-row-container";
    row.style.marginBottom = "8px";
    row.innerHTML = `
          <div class="cloud-clip-item" style="display:flex; justify-content:space-between; align-items:center; padding:9px 12px; background:#070d1a; border:1px solid #1e293b; border-radius:8px;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-weight:600; color:#e0f2fe;">🎬 ${escapeHtml(item.title)}</span>
              <span class="badge ok" style="font-size:0.68rem; padding:2px 6px;">v${activeVer} / 共 ${totalVers} 版</span>
            </div>
            <div style="display:flex; gap:6px;">
              <button type="button" class="btn" style="padding:4px 10px; font-size:0.75rem;" onclick="playPlaylistItem(${safeIdx})">試播</button>
              <button type="button" id="btn-toggle-drawer-${safeIdx}" class="btn" style="padding:4px 10px; font-size:0.75rem; border-color:#38bdf8; color:#7dd3fc; background:rgba(56,189,248,0.14); font-weight:600;" onclick="toggleRerollDrawer(${safeIdx}, this)">微調 ▾</button>
              <a class="btn cloud-clip-download-link" download style="padding:4px 10px; font-size:0.75rem;">下載</a>
            </div>
          </div>

          <div id="reroll-drawer-${safeIdx}" style="display:none; background:#050914; border:1px solid #1e3a5f; border-top:none; border-radius:0 0 8px 8px; padding:12px 14px; margin-top:-2px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:6px;">
              <div style="display:flex; align-items:center; gap:6px;">
                <span style="font-size:0.74rem; color:#94a3b8;">版本歷程：</span>
                ${versionsHtml}
              </div>
              <div style="font-size:0.72rem; color:#64748b;">自動保留歷史版本，可隨時復原</div>
            </div>

            <div style="margin-bottom:10px;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                <label style="font-size:0.76rem; color:#cbd5e1; font-weight:600;">本段提示詞：</label>
                <div style="display:flex; align-items:center; gap:6px;">
                  <span style="font-size:0.72rem; color:#94a3b8;">目標尾幀：</span>
                  <select id="reroll-panel-${safeIdx}" style="padding:3px 6px; font-size:0.76rem; width:90px; background:#091222; color:#cbd5e1; border:1px solid #1e293b; border-radius:4px;">
                    ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<option value="${n}" ${n === panelVal ? "selected" : ""}>Panel ${n}</option>`).join("")}
                  </select>
                </div>
              </div>
              <textarea id="reroll-prompt-${safeIdx}" rows="3" style="width:100%; font-size:0.8rem; background:#070d1a; color:#cbd5e1; border:1px solid #1e293b; border-radius:6px; padding:6px 8px; resize:vertical; line-height:1.4;"></textarea>
            </div>

            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
              <div style="display:flex; align-items:center; gap:6px;">
                <span style="font-size:0.72rem; color:#94a3b8;">Seed:</span>
                <input type="number" id="reroll-seed-${safeIdx}" value="${20260931 + safeIdx}" style="width:105px; padding:4px 6px; font-size:0.75rem; background:#070d1a; border:1px solid #1e293b; color:#cbd5e1; border-radius:4px;" />
                <button type="button" class="btn" style="padding:3px 8px; font-size:0.72rem;" onclick="randomizeRerollSeed(${safeIdx})">換種子</button>
              </div>
              <div style="display:flex; gap:8px; flex-wrap:wrap;">
                <button type="button" class="btn" style="padding:6px 12px; font-size:0.78rem; background:rgba(56,189,248,0.2); border-color:#38bdf8; color:#7dd3fc; font-weight:700;" onclick="rerollShotAudio(${safeIdx + 1})" title="調用 H3 代理畫布極速重抽 32kHz 音軌，保留原片聲紋與背景音樂">
                  重抽音軌
                </button>
                <button type="button" class="btn" style="padding:6px 14px; font-size:0.8rem; background:linear-gradient(135deg, #0284c7, #0369a1); border-color:#38bdf8; color:#fff; font-weight:700; box-shadow:0 2px 8px rgba(2,132,199,0.3);" onclick="triggerRerollExecution(${safeIdx}, 'single')">
                  重算此段
                </button>
                <button type="button" class="btn" style="padding:6px 14px; font-size:0.8rem; background:linear-gradient(135deg, #7c3aed, #6d28d9); border-color:#a855f7; color:#fff; font-weight:700; box-shadow:0 2px 8px rgba(124,58,237,0.3);" onclick="triggerRerollExecution(${safeIdx}, 'cascade')">
                  連鎖重算
                </button>
              </div>
            </div>
          </div>
        `;
    const dlLink = row.querySelector<HTMLAnchorElement>(".cloud-clip-download-link");
    if (dlLink) {
      if (safeUrl) {
        dlLink.setAttribute("href", safeUrl);
      } else {
        dlLink.removeAttribute("href");
        dlLink.style.opacity = "0.5";
        dlLink.style.pointerEvents = "none";
      }
    }
    const rerollTa = row.querySelector<HTMLTextAreaElement>(`#reroll-prompt-${safeIdx}`);
    if (rerollTa) {
      rerollTa.value = promptVal;
    }
    list.appendChild(row);
  });

  if (historyMutated) {
    computeStore.patchCompute({
      segmentHistory: nextHistory,
      activeVersionIndex: nextActiveVer,
    });
  }
}

export { rerollShotAudio };
