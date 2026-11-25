import type { LocalEnvState } from "./types/studio.ts";
import { TIMING_CONSTANTS } from "./config/constants.ts";
import { computeStore } from "./stores/computeStore.ts";
import { escapeHtml } from "./utils/domSafety.ts";
import { getPrefs, onPromptProviderChange, selectRoute } from "./features/uiShell.ts";
import { onChainParadigmChange } from "./features/storyboardEditor.ts";
import { checkComfyConnection } from "./features/dispatchLocalComfy.ts";
import { closeCostConfirmDialog, syncCloudKeyUI, updateCloudCostEstimate } from "./features/dispatchCloudApi.ts";
import { playVideoInStage } from "./features/stagePlayer.ts";
import { updatePlayerSoftSubtitle } from "./features/audioSubtitles.ts";
import { initWorkspaceOnLoad, scheduleAutoSave } from "./features/workspaceManager.ts";

export function registerStudioBootstrap(): void {
  if (typeof window === "undefined") return;

  window.addEventListener("DOMContentLoaded", () => {
    const p = getPrefs();
    const promptSel = document.getElementById("promptProviderSelect") as HTMLSelectElement | null;
    const imageSel = document.getElementById("imageProviderSelect") as HTMLSelectElement | null;
    if (promptSel) promptSel.value = p.promptProvider;
    if (imageSel) imageSel.value = p.imageProvider;
    selectRoute("colab");
    void checkComfyConnection();
    void initWorkspaceOnLoad();
    onPromptProviderChange();
    onChainParadigmChange(false);

    const envSubTimer = setInterval(() => {
      if (!window.H3LocalEnv) return;
      clearInterval(envSubTimer);
      window.H3LocalEnv.subscribe((st: LocalEnvState) => {
        const engineEl = document.getElementById("localDetectedEngineBadge");
        if (!engineEl) return;
        if (st.daemon === "online") {
          engineEl.innerHTML = `🟢 當前選用引擎：<strong style="color:#6ee7b7;">H3 Metal 原生守護進程 (127.0.0.1:8080)${st.hardware.availableGiB !== null ? ` · 可用 RAM ${escapeHtml(String(st.hardware.availableGiB))} GiB` : ""}</strong>`;
        } else {
          engineEl.innerHTML =
            '⚪ 引擎狀態：<span style="color:#fca5a5;">未偵測到本機引擎（請看右下角「本地環境中樞」完成安裝與啟動）</span>';
        }
      });
    }, TIMING_CONSTANTS.ENV_POLL_INTERVAL_MS);
    setTimeout(() => clearInterval(envSubTimer), TIMING_CONSTANTS.ENV_POLL_TIMEOUT_MS);

    const descEl = document.getElementById("chineseDesc");
    if (descEl) descEl.addEventListener("input", () => scheduleAutoSave());
    const segsEl = document.getElementById("segmentsContainer");
    if (segsEl) {
      segsEl.addEventListener("input", () => scheduleAutoSave());
      segsEl.addEventListener("change", () => scheduleAutoSave());
    }
    const dlgEl = document.getElementById("dialogueTrackList");
    if (dlgEl) {
      dlgEl.addEventListener("input", () => scheduleAutoSave());
      dlgEl.addEventListener("change", () => scheduleAutoSave());
    }

    const infoDialog = document.getElementById("infoTipDialog") as HTMLDialogElement | null;
    if (infoDialog) {
      infoDialog.addEventListener("click", (e) => {
        const rect = infoDialog.getBoundingClientRect();
        if (
          e.clientX < rect.left ||
          e.clientX > rect.right ||
          e.clientY < rect.top ||
          e.clientY > rect.bottom
        ) {
          infoDialog.close();
        }
      });
    }

    const costDialog = document.getElementById("costConfirmDialog") as HTMLDialogElement | null;
    if (costDialog) {
      costDialog.addEventListener("click", (e) => {
        const rect = costDialog.getBoundingClientRect();
        if (
          e.clientX < rect.left ||
          e.clientX > rect.right ||
          e.clientY < rect.top ||
          e.clientY > rect.bottom
        ) {
          closeCostConfirmDialog(false);
        }
      });
    }

    syncCloudKeyUI();
    updateCloudCostEstimate();

    const player = document.getElementById("mainVideoPlayer") as HTMLVideoElement | null;
    if (player) {
      player.addEventListener("timeupdate", () => {
        updatePlayerSoftSubtitle(player.currentTime);
      });
      player.addEventListener("ended", () => {
        const { isSeamlessPlaying, seamlessIndex, currentPlaylist } = computeStore.getState();
        if (isSeamlessPlaying && currentPlaylist.length > 0) {
          const nextIndex = seamlessIndex + 1;
          computeStore.setSeamlessPlayback(true, nextIndex);
          if (nextIndex < currentPlaylist.length) {
            playVideoInStage(
              currentPlaylist[nextIndex].url,
              `▶️ 連播中 (第 ${nextIndex + 1}/${currentPlaylist.length} 段)：${currentPlaylist[nextIndex].title}`
            );
            player.play().catch((err) => console.debug("Seamless next play skipped:", err));
          } else {
            computeStore.setSeamlessPlayback(false, nextIndex);
            const btn = document.getElementById("seamlessPlayBtn");
            const labelEl = document.getElementById("currentVideoLabel");
            if (btn) btn.textContent = "▶️ 連續無縫全片播放";
            if (labelEl) labelEl.textContent = "✅ 全片連續播放完成！";
          }
        }
      });
    }
    const masterPlayer = document.getElementById("masterFinalVideoPlayer") as HTMLVideoElement | null;
    if (masterPlayer) {
      masterPlayer.addEventListener("timeupdate", () => {
        updatePlayerSoftSubtitle(masterPlayer.currentTime);
      });
    }
  });
}
