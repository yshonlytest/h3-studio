/**
 * H3 Storyboard Studio - Audio & Subtitle Studio Controller
 * Extracted from index.html (Step 5: Post-Production Studio)
 */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.H3StudioAudioSubtitles = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Controller functions will attach to window in browser environment
  // for inline event handlers (onchange, onclick, oninput) in index.html.

  return {
    version: "2.0.0"
  };
});

    // ==================== Step 5: Post-Production Studio (TTS, BGM, Subtitles & Master Mux) ====================
    let currentDialogueItems = [];
    let bgmAudioCtx = null;
    let bgmAudioSource = null;
    let bgmGainNode = null;
    let isBgmPlaying = false;
    let customBgmAudioBuffer = null;
    let softSubtitleEnabled = true;

    function syncDialogueItemsFromPlan() {
      if (!currentPlan || !Array.isArray(currentPlan.segments)) return;
      const segs = currentPlan.segments;
      const newItems = [];
      const isEdu = activeProjectMode === "edu" || currentPlan?.project_mode === "edu_explainer";
      let runningSec = 0;

      segs.forEach((seg, idx) => {
        const segDur = isEdu ? Math.round(((seg.frames || 124) / 24) * 10) / 10 : 5.0;
        const baseSec = isEdu ? Math.round(runningSec * 10) / 10 : idx * 5.0;
        runningSec += segDur;

        const extracted = typeof H3AudioStudio !== 'undefined'
          ? H3AudioStudio.extractDialogueInfo(seg.prompt || "", idx)
          : { text: "", startOffsetSec: 1.5, durationSec: 2.5 };

        const dialogueText = seg.display_dialogue || seg.dialogue || extracted.text || "";
        const existing = currentDialogueItems[idx];
        const text = existing && existing.userEdited ? existing.text : dialogueText;

        const charCount = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf\w]/g) || []).length;
        const naturalDur = isEdu && charCount > 0
          ? Math.max(2.0, Math.min(segDur - 0.5, Math.round(((charCount / 3.6) + 0.6) * 10) / 10))
          : extracted.durationSec;
        const naturalOffset = isEdu ? 0.5 : extracted.startOffsetSec;

        newItems.push({
          partIndex: idx,
          partTitle: seg.title || `Part ${idx + 1}`,
          role: "角色",
          text: text,
          baseSec: baseSec,
          segDurationSec: segDur,
          startOffsetSec: existing && existing.userEdited ? existing.startOffsetSec : naturalOffset,
          durationSec: existing && existing.userEdited ? existing.durationSec : naturalDur,
          userEdited: existing ? existing.userEdited : false,
          audioBlobUrl: existing ? existing.audioBlobUrl : null
        });
      });

      currentDialogueItems = newItems;
      renderDialogueTrackList();
    }

    function renderDialogueTrackList() {
      const container = document.getElementById("dialogueTrackList");
      if (!container) return;

      if (!currentDialogueItems.length) {
        container.innerHTML = `<div style="color:#64748b; font-size:0.82rem; padding:8px 0;">目前無分鏡台詞。請先於步驟一生成分鏡腳本。</div>`;
        return;
      }

      container.innerHTML = currentDialogueItems.map((item, idx) => {
        const segSecStart = typeof item.baseSec === 'number' ? item.baseSec : idx * 5;
        const segSecEnd = typeof item.segDurationSec === 'number' ? Math.round((segSecStart + item.segDurationSec) * 10) / 10 : (idx + 1) * 5;
        const hasText = item.text && item.text.trim();

        return `
          <div style="background:#070d1a; border:1px solid #1e293b; border-radius:8px; padding:10px 14px; display:flex; flex-direction:column; gap:8px;">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
              <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                <span class="part-pill">Part ${idx + 1}</span>
                <span class="time-pill">⏱️ ${segSecStart} - ${segSecEnd}s</span>
                <span style="font-size:0.8rem; font-weight:600; color:#e2e8f0;">${escapeHtml(item.partTitle || ('Part ' + (idx + 1)))}</span>
              </div>
              <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                <span style="font-size:0.74rem; color:#94a3b8;">起音時間：鏡段第</span>
                <input type="number" min="0" max="4.5" step="0.5" value="${item.startOffsetSec}" style="width:62px; padding:3px 6px; font-size:0.76rem; background:#0f172a; border:1px solid #334155; border-radius:4px; color:#cbd5e1;" onchange="updateDialogueOffset(${idx}, this.value)" />
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
              <input type="text" value="${escapeHtml(item.text || '')}" placeholder="（本段暫無台詞，可自由輸入角色對白...）" style="width:100%; padding:6px 10px; font-size:0.84rem; background:#0c1322; border:1px solid ${hasText ? '#2563eb' : '#334155'}; border-radius:6px; color:#f8fafc;" oninput="updateDialogueText(${idx}, this.value)" />
            </div>
          </div>
        `;
      }).join("");
    }

    function updateDialogueText(idx, val) {
      if (currentDialogueItems[idx]) {
        currentDialogueItems[idx].text = val;
        currentDialogueItems[idx].userEdited = true;
      }
    }

    function updateDialogueOffset(idx, val) {
      if (currentDialogueItems[idx]) {
        const offset = parseFloat(val) || 0;
        currentDialogueItems[idx].startOffsetSec = Math.max(0, Math.min(4.5, offset));
        currentDialogueItems[idx].userEdited = true;
      }
    }

    function onTtsEngineChange(_val) {}

    async function previewSingleDialogue(idx) {
      const shotUrl = `outputs/shot_${idx + 1}.mp4`;
      try {
        const audio = new Audio(shotUrl);
        audio.currentTime = 0;
        await audio.play();
        showToast(`🔊 播放 Part ${idx + 1} 原片音訊...`);
      } catch (_e) {
        showToast(`💡 Part ${idx + 1} 尚未產出音訊，請點選「重抽音軌」`);
      }
    }

    async function applySingleDialogueToVideo(idx) {
      if (typeof rerollShotAudio === "function") {
        await rerollShotAudio(idx + 1);
      }
    }

    function onBgmStyleChange(val) {
      const uploadBox = document.getElementById("customBgmUploadBox");
      if (uploadBox) {
        uploadBox.style.display = val === "custom" ? "block" : "none";
      }
      if (isBgmPlaying) {
        toggleBgmAudioPreview();
      }
    }

    function updateBgmVolume(val) {
      const label = document.getElementById("bgmVolumeLabel");
      if (label) label.textContent = `${val}%`;
      if (bgmGainNode && bgmAudioCtx) {
        const gain = (parseInt(val, 10) || 0) / 100;
        bgmGainNode.gain.setValueAtTime(gain, bgmAudioCtx.currentTime);
      }
    }

    async function handleCustomBgmUpload(input) {
      if (!input.files || !input.files[0]) return;
      const file = input.files[0];
      try {
        const arrayBuf = await file.arrayBuffer();
        const actx = new (window.AudioContext || window.webkitAudioContext)();
        customBgmAudioBuffer = await actx.decodeAudioData(arrayBuf);
        showToast(`🎵 已載入自訂音樂檔: ${file.name} (${Math.round(customBgmAudioBuffer.duration)}秒)`);
      } catch (err) {
        showToast(`❌ 自訂音樂檔解碼失敗: ${err.message}`);
      }
    }

    async function toggleBgmAudioPreview() {
      const btn = document.getElementById("previewBgmBtn");
      if (isBgmPlaying) {
        if (bgmAudioSource) {
          try { bgmAudioSource.stop(); } catch(e){}
          bgmAudioSource = null;
        }
        isBgmPlaying = false;
        if (btn) btn.textContent = "試聽";
        return;
      }

      const style = document.getElementById("bgmStyleSelect")?.value || "fantasy";
      if (style === "none") {
        showToast("⚠️ 目前選擇為「無背景襯樂」");
        return;
      }

      try {
        if (!bgmAudioCtx) {
          bgmAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (bgmAudioCtx.state === "suspended") {
          await bgmAudioCtx.resume();
        }

        let buffer = null;
        if (style === "custom") {
          buffer = customBgmAudioBuffer;
          if (!buffer) {
            showToast("⚠️ 請先選擇並上傳本地音樂檔案！");
            return;
          }
        } else if (typeof H3AudioStudio !== "undefined") {
          buffer = H3AudioStudio.generateProceduralBgmBuffer(bgmAudioCtx, style, 15);
        }

        if (!buffer) return;

        bgmGainNode = bgmAudioCtx.createGain();
        const vol = (parseInt(document.getElementById("bgmVolumeSlider")?.value, 10) || 35) / 100;
        bgmGainNode.gain.setValueAtTime(vol, bgmAudioCtx.currentTime);
        bgmGainNode.connect(bgmAudioCtx.destination);

        bgmAudioSource = bgmAudioCtx.createBufferSource();
        bgmAudioSource.buffer = buffer;
        bgmAudioSource.loop = true;
        bgmAudioSource.connect(bgmGainNode);
        bgmAudioSource.start();

        isBgmPlaying = true;
        if (btn) btn.textContent = "停止";
        showToast("🎶 正在試聽背景襯樂...");
      } catch (err) {
        showToast(`❌ 襯樂播放失敗: ${err.message}`);
      }
    }

    function downloadSubtitleFile(format) {
      if (!currentDialogueItems.length) {
        showToast("⚠️ 目前沒有台詞可輸出字幕");
        return;
      }
      let content = "";
      let filename = `storyboard_subtitles.${format}`;
      if (format === "srt" && typeof H3AudioStudio !== "undefined") {
        content = H3AudioStudio.generateSrt(currentDialogueItems);
      } else if (format === "vtt" && typeof H3AudioStudio !== "undefined") {
        content = H3AudioStudio.generateVtt(currentDialogueItems);
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

    function toggleSoftSubtitleOverlay(checked) {
      softSubtitleEnabled = checked;
      const o1 = document.getElementById("playerSubtitleOverlay");
      const o2 = document.getElementById("masterSubtitleOverlay");
      if (!checked) {
        if (o1) o1.style.opacity = "0";
        if (o2) o2.style.opacity = "0";
      }
    }

    function updatePlayerSoftSubtitle(timeSec) {
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

    async function executeMasterAudioVideoMux() {
      const sourceVideoUrl = document.getElementById("mainVideoPlayer")?.src ||
        (currentPlaylist[0] ? currentPlaylist[0].url : "") ||
        SHISA_DEFAULT_CONFIG.merged_video_path;

      if (!sourceVideoUrl) {
        showToast("⚠️ 尚未載入或生成任何基礎影片！請先完成步驟三或四。");
        return;
      }

      const mixBtn = document.getElementById("masterMixBtn");
      const progressBox = document.getElementById("masterMuxProgressBox");
      const progressBar = document.getElementById("masterMuxProgressBar");
      const stageText = document.getElementById("masterMuxStageText");
      const percentText = document.getElementById("masterMuxPercentText");
      const logText = document.getElementById("masterMuxLogText");

      mixBtn.disabled = true;
      progressBox.style.display = "block";
      progressBar.style.width = "10%";
      stageText.textContent = "🎙️ 正在準備角色台詞語音與音樂軌...";
      percentText.textContent = "10%";
      logText.textContent = "初始化 Web Audio 混音工作空間...";

      try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const sampleRate = audioCtx.sampleRate;
        const totalDurationSec = currentDialogueItems.reduce((acc, it) => acc + (typeof it.segDurationSec === "number" ? it.segDurationSec : 5.0), 0) || Math.max(5, currentDialogueItems.length * 5);

        // 1. 取得或合成襯樂
        const bgmStyle = document.getElementById("bgmStyleSelect")?.value || "fantasy";
        let bgmBuffer = null;
        if (bgmStyle === "custom" && customBgmAudioBuffer) {
          bgmBuffer = customBgmAudioBuffer;
        } else if (bgmStyle !== "none" && typeof H3AudioStudio !== "undefined") {
          bgmBuffer = H3AudioStudio.generateProceduralBgmBuffer(audioCtx, bgmStyle, totalDurationSec);
        }

        // 2. 載入各鏡原片 32kHz 音訊軌
        progressBar.style.width = "30%";
        percentText.textContent = "30%";
        logText.textContent = "載入各鏡原片音訊軌...";

        const dialogueBuffers = [];
        for (let i = 0; i < currentDialogueItems.length; i++) {
          const item = currentDialogueItems[i];
          let buf = null;
          try {
            const res = await fetch(`outputs/shot_${i + 1}.mp4`);
            if (res.ok) {
              const arrayBuf = await res.arrayBuffer();
              buf = await audioCtx.decodeAudioData(arrayBuf);
            }
          } catch (_e) {}

          if (buf) {
            dialogueBuffers.push({
              item,
              buffer: buf,
              time: i * 5
            });
          }
        }

        // 3. OfflineAudioContext 離線渲染多軌混音
        progressBar.style.width = "50%";
        percentText.textContent = "50%";
        stageText.textContent = "🎚️ 正在多軌渲染 (對白 + 閃避 Ducking 襯樂)...";
        logText.textContent = "運算雙耳立體聲混音軌...";

        const offlineCtx = new OfflineAudioContext(2, Math.floor(sampleRate * totalDurationSec), sampleRate);

        // BGM Track with Ducking
        if (bgmBuffer) {
          const bgmSource = offlineCtx.createBufferSource();
          bgmSource.buffer = bgmBuffer;
          bgmSource.loop = true;

          const bgmGain = offlineCtx.createGain();
          const baseVol = (parseInt(document.getElementById("bgmVolumeSlider")?.value, 10) || 35) / 100;
          bgmGain.gain.setValueAtTime(baseVol, 0);

          const duckingEnabled = document.getElementById("audioDuckingCheck")?.checked ?? true;
          if (duckingEnabled && typeof H3AudioStudio !== "undefined") {
            const duckingRanges = H3AudioStudio.calculateDuckingRanges(currentDialogueItems);
            duckingRanges.forEach(range => {
              const duckVol = Math.max(0.05, baseVol * 0.25); // 衰減 75%
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

        // Dialogue Tracks
        dialogueBuffers.forEach(d => {
          const dSource = offlineCtx.createBufferSource();
          dSource.buffer = d.buffer;
          const dGain = offlineCtx.createGain();
          dGain.gain.setValueAtTime(1.0, 0);
          dSource.connect(dGain);
          dGain.connect(offlineCtx.destination);
          dSource.start(d.time);
        });

        const mixedAudioBuffer = await offlineCtx.startRendering();

        // 4. 合成視訊畫面與音訊軌
        progressBar.style.width = "75%";
        percentText.textContent = "75%";
        stageText.textContent = "🎬 正在將影片、混音軌與動態字幕合為一體...";
        logText.textContent = "啟動端側極速封裝引擎...";

        const burnIn = document.getElementById("burnInSubtitleCheck")?.checked ?? false;
        const v = document.createElement("video");
        v.crossOrigin = "anonymous";
        v.playsInline = true;
        v.muted = true;
        v.src = sourceVideoUrl;
        await new Promise((resolve, reject) => {
          v.onloadedmetadata = () => resolve();
          v.onerror = (e) => reject(new Error("基礎影片載入失敗，無法完成合成"));
        });

        const canvas = document.createElement("canvas");
        canvas.width = v.videoWidth || 640;
        canvas.height = v.videoHeight || 480;
        const ctx = canvas.getContext("2d");

        // 建立音訊串流節點
        const realAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
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
          : (MediaRecorder.isTypeSupported("video/mp4") ? "video/mp4" : "video/webm");

        const recorder = new MediaRecorder(canvasStream, { mimeType: mime });
        const recordedChunks = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) recordedChunks.push(e.data);
        };

        const renderCompletePromise = new Promise((resolve) => {
          recorder.onstop = () => resolve();
        });

        recorder.start();
        masterSource.start(0);
        await v.play();

        const drawLoop = () => {
          if (v.paused || v.ended) return;
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height);

          // 若勾選燒錄字幕 (Burn-in)，在此即時壓印在畫面底部
          if (burnIn && currentDialogueItems.length) {
            const curTime = v.currentTime;
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

            if (sub) {
              ctx.save();
              ctx.font = "bold 20px 'Segoe UI', system-ui, sans-serif";
              const textWidth = ctx.measureText(sub).width;
              const boxPadX = 16;
              const boxHeight = 36;
              const boxX = (canvas.width - textWidth - boxPadX * 2) / 2;
              const boxY = canvas.height - 56;

              // 圓角半透明背景黑底
              ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
              ctx.fillRect(boxX, boxY, textWidth + boxPadX * 2, boxHeight);

              // 亮白居中文字與微陰影
              ctx.fillStyle = "#ffffff";
              ctx.shadowColor = "rgba(0,0,0,0.9)";
              ctx.shadowBlur = 4;
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.fillText(sub, canvas.width / 2, boxY + boxHeight / 2);
              ctx.restore();
            }
          }

          requestAnimationFrame(drawLoop);
        };
        requestAnimationFrame(drawLoop);

        await new Promise((res) => {
          v.onended = () => res();
        });

        recorder.stop();
        await renderCompletePromise;
        try { masterSource.stop(); } catch(e){}

        const finalBlob = new Blob(recordedChunks, { type: mime });
        const finalUrl = URL.createObjectURL(finalBlob);

        progressBar.style.width = "100%";
        percentText.textContent = "100%";
        stageText.textContent = "🎉 廣播級成片合成成功！";
        logText.textContent = "音畫合一已就緒，可立即預覽與下載。";

        const stage = document.getElementById("masterFinalVideoStage");
        const masterPlayer = document.getElementById("masterFinalVideoPlayer");
        const dlBtn = document.getElementById("downloadMasterVideoBtn");

        stage.style.display = "block";
        masterPlayer.src = finalUrl;
        masterPlayer.load();
        masterPlayer.play().catch(() => {});

        dlBtn.href = finalUrl;
        dlBtn.download = `filmchain_${currentPlan?.project_slug || "storyboard"}_cinematic_master.${mime.includes("mp4") ? "mp4" : "webm"}`;

        showToast("🌟 恭喜！廣播級完整影視成片已合成完畢！");
        playCompletionChime();
        stage.scrollIntoView({ behavior: "smooth" });
      } catch (err) {
        showToast(`❌ 合成成片失敗: ${err.message}`);
        stageText.textContent = "❌ 合成中斷";
        logText.textContent = err.message;
      } finally {
        mixBtn.disabled = false;
      }
    }


