import type { LexiconData } from "../types/studio.ts";
import { LOCAL_DAEMON_BASE_URL } from "../config/constants.ts";
import { getErrorMessage } from "../utils/errors.ts";
import { audioSubtitleStore } from "../stores/audioSubtitleStore.ts";
import { storyboardStore } from "../stores/storyboardStore.ts";
import { escapeHtml, getPrefs, showToast } from "./uiShell.ts";
import { syncSegmentsFromDOM } from "./storyboardEditor.ts";
import { playVideoInStage } from "./stagePlayer.ts";

export function applyPhoneticSubstitutions(text: string, lang = "zh-TW"): string {
  if (!text || typeof text !== "string") return "";
  const activeLexiconData = storyboardStore.getState().activeLexiconData;
  const dict = ((activeLexiconData[lang] || activeLexiconData["zh-TW"] || {}) as Record<string, string>);
  let result = text;
  const sortedKeys = Object.keys(dict).sort((a, b) => b.length - a.length);
  for (const word of sortedKeys) {
    if (result.includes(word)) {
      result = result.split(word).join(dict[word]);
    }
  }
  return result;
}

export function renderPhoneticHintBadge(text: string): string {
  if (!text) return `<span style="color:#64748b;">(無台詞)</span>`;
  const dict = ((storyboardStore.getState().activeLexiconData["zh-TW"] || {}) as Record<string, string>);
  const matched = Object.keys(dict).filter((k) => text.includes(k));
  if (matched.length > 0) {
    return `<span style="color:#f59e0b; font-weight:600;" title="已自動套用唯一單音字防破音">🔤 破音校正: ${matched.map((k) => `${escapeHtml(k)}➔${escapeHtml(dict[k])}`).join("、")}</span>`;
  }
  return `<span style="color:#10b981;">✅ 發音檢測無多音歧義</span>`;
}

export function toggleShotPhoneticsDrawer(btn: HTMLElement, _shotIdx?: number): void {
  const card = btn.closest(".segment-card");
  if (!card) return;
  const drawer = card.querySelector<HTMLElement>(".seg-phonetics-drawer");
  if (!drawer) return;
  const isHidden = drawer.style.display === "none";
  drawer.style.display = isHidden ? "block" : "none";
  btn.textContent = isHidden ? "發音校正 ▴" : "發音校正 ▾";
}

export function onDisplayDialogueChange(input: HTMLInputElement, segIdx: number): void {
  const currentPlan = storyboardStore.getState().currentPlan;
  if (currentPlan && currentPlan.segments && currentPlan.segments[segIdx]) {
    storyboardStore.updateSegmentAt(segIdx, { display_dialogue: input.value.trim() });
    syncSegmentsFromDOM();
  }
}

export function onSpokenDialogueChange(input: HTMLInputElement, segIdx: number): void {
  const currentPlan = storyboardStore.getState().currentPlan;
  if (currentPlan && currentPlan.segments && currentPlan.segments[segIdx]) {
    storyboardStore.updateSegmentAt(segIdx, { spoken_dialogue: input.value.trim() });
    syncSegmentsFromDOM();
  }
}

export async function rerollShotAudio(shotIdx: number): Promise<void> {
  const currentPlan = storyboardStore.getState().currentPlan;
  const currentDialogueItems = audioSubtitleStore.getState().currentDialogueItems;
  const seg = currentPlan?.segments ? currentPlan.segments[shotIdx - 1] : null;
  const studioText = currentDialogueItems[shotIdx - 1] ? currentDialogueItems[shotIdx - 1].text : "";
  const cards = document.querySelectorAll("#segmentsContainer .segment-card");
  const card = cards[shotIdx - 1];
  const dialInput = card ? card.querySelector<HTMLInputElement>(".seg-dialogue-input") : null;
  const spokenInput = card ? card.querySelector<HTMLInputElement>(".seg-spoken-dialogue-input") : null;
  const spokenText =
    (spokenInput && spokenInput.value.trim()) ||
    (dialInput && dialInput.value.trim()) ||
    studioText ||
    (seg && (seg.spoken_dialogue || seg.dialogue)) ||
    "";

  showToast(`🎙️ 正以 256x160 代理畫布極速重抽 Shot ${shotIdx} 32kHz 音訊...`);
  try {
    const res = await fetch(`${LOCAL_DAEMON_BASE_URL}/api/audio-reroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shot_index: shotIdx,
        spoken_dialogue: spokenText,
        project_id: currentPlan?.project_slug || "default_project",
      }),
    });
    if (res.ok) {
      await res.json();
      showToast(`✅ Shot ${shotIdx} 音訊重抽並換入完成！`);
      playVideoInStage(`outputs/shot_${shotIdx}.mp4?t=${Date.now()}`, `Shot ${shotIdx} (換入新音軌)`, true);
    } else {
      showToast("⚠️ 後端音軌重抽回傳未完成，請確認守護進程運行中");
    }
  } catch (err) {
    console.debug("Audio reroll daemon offline:", err);
    showToast("💡 提示：本機守護進程離線時可於終端機執行 h3_audio_reroller.py");
  }
}

export async function replaceShotSpeechOnly(shotIdx: number): Promise<void> {
  const currentPlan = storyboardStore.getState().currentPlan;
  const currentDialogueItems = audioSubtitleStore.getState().currentDialogueItems;
  const seg = currentPlan?.segments ? currentPlan.segments[shotIdx - 1] : null;
  const studioText = currentDialogueItems[shotIdx - 1] ? currentDialogueItems[shotIdx - 1].text : "";
  const cards = document.querySelectorAll("#segmentsContainer .segment-card");
  const card = cards[shotIdx - 1];
  const dialInput = card ? card.querySelector<HTMLInputElement>(".seg-dialogue-input") : null;
  const spokenInput = card ? card.querySelector<HTMLInputElement>(".seg-spoken-dialogue-input") : null;
  const textToSpeak =
    (spokenInput && spokenInput.value.trim()) ||
    (dialInput && dialInput.value.trim()) ||
    studioText ||
    (seg && (seg.spoken_dialogue || seg.dialogue)) ||
    "";

  if (!textToSpeak) {
    showToast(`⚠️ Shot ${shotIdx} 尚未輸入台詞文字！`);
    return;
  }

  showToast(`⚡ 正在以純語音模式秒級換入 Shot ${shotIdx}...`);
  try {
    let audioBase64: string | null = null;
    const geminiKey = getPrefs().geminiKey || (document.getElementById("geminiKeyInput") as HTMLInputElement | null)?.value?.trim();
    if (geminiKey && typeof window.H3AudioStudio !== "undefined") {
      try {
        audioBase64 = await window.H3AudioStudio.synthesizeSpeechGemini({
          apiKey: geminiKey,
          text: textToSpeak,
          voice: "Puck",
        });
      } catch (err) {
        console.debug("Gemini speech synthesis fallback:", err);
        audioBase64 = null;
      }
    }

    if (audioBase64) {
      const res = await fetch(`${LOCAL_DAEMON_BASE_URL}/api/replace-audio-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shot_index: shotIdx,
          audio_base64: audioBase64,
          project_id: currentPlan?.project_slug || "default_project",
        }),
      });
      if (res.ok) {
        showToast(`🎉 Shot ${shotIdx} 純語音已成功無損換入影片！（0 視訊算力消耗）`);
        playVideoInStage(`outputs/shot_${shotIdx}.mp4?t=${Date.now()}`, `Shot ${shotIdx} (純語音換軌)`, true);
        return;
      }
    }

    await rerollShotAudio(shotIdx);
  } catch (err: unknown) {
    showToast(`💡 已自動調用 H3 代理音訊換軌：${getErrorMessage(err)}`);
    await rerollShotAudio(shotIdx);
  }
}

export async function openPronunciationLexiconModal(): Promise<void> {
  const modal = document.getElementById("lexiconModal");
  if (!modal) return;
  modal.style.display = "flex";
  await loadPronunciationLexiconFromBackend();
  renderLexiconTable();
}

export function closePronunciationLexiconModal(): void {
  const modal = document.getElementById("lexiconModal");
  if (modal) modal.style.display = "none";
}

export async function loadPronunciationLexiconFromBackend(): Promise<void> {
  try {
    const res = await fetch(`${LOCAL_DAEMON_BASE_URL}/api/lexicon`);
    if (res.ok) {
      const json = await res.json();
      if (json.lexicon && typeof json.lexicon === "object") {
        storyboardStore.setLexiconData(json.lexicon as LexiconData);
      }
    }
  } catch (err) {
    console.debug("Lexicon load offline fallback:", err);
  }
}

export function renderLexiconTable(): void {
  const listEl = document.getElementById("lexiconRuleList");
  if (!listEl) return;
  const dict = ((storyboardStore.getState().activeLexiconData["zh-TW"] || {}) as Record<string, string>);
  const keys = Object.keys(dict);
  if (!keys.length) {
    listEl.innerHTML = `<div style="color:#64748b; font-size:0.8rem; padding:8px 0;">目前無規則。可於上方新增。</div>`;
    return;
  }
  listEl.innerHTML = keys
    .map((orig) => {
      const spoken = dict[orig];
      return `
          <div style="display:flex; justify-content:space-between; align-items:center; background:#0f172a; padding:6px 12px; border-radius:6px; border:1px solid #1e293b;">
            <div style="font-size:0.82rem; display:flex; align-items:center; gap:8px;">
              <span style="color:#cbd5e1; font-weight:600;">${escapeHtml(orig)}</span>
              <span style="color:#64748b;">➔</span>
              <span style="color:#fde68a;">${escapeHtml(spoken)}</span>
            </div>
            <button type="button" class="btn" data-lexicon-key="${escapeHtml(orig)}" onclick="deleteLexiconRule(this.dataset.lexiconKey || '')" style="padding:2px 8px; font-size:0.75rem; background:rgba(239,68,68,0.2); border-color:#ef4444; color:#fca5a5;">刪除</button>
          </div>
        `;
    })
    .join("");
}

export function addNewLexiconRule(): void {
  const origInput = document.getElementById("newLexiconOriginal") as HTMLInputElement | null;
  const spokenInput = document.getElementById("newLexiconSpoken") as HTMLInputElement | null;
  const orig = origInput?.value.trim();
  const spoken = spokenInput?.value.trim();
  if (!orig || !spoken) {
    showToast("⚠️ 請輸入原始詞與口播替換字");
    return;
  }
  const activeLexiconData = storyboardStore.getState().activeLexiconData;
  const prevDict = ((activeLexiconData["zh-TW"] || {}) as Record<string, string>);
  storyboardStore.setLexiconData({
    ...activeLexiconData,
    "zh-TW": { ...prevDict, [orig]: spoken },
  });
  if (origInput) origInput.value = "";
  if (spokenInput) spokenInput.value = "";
  renderLexiconTable();
  showToast(`➕ 已新增發音規則：${orig} ➔ ${spoken}`);
}

export function deleteLexiconRule(key: string): void {
  const activeLexiconData = storyboardStore.getState().activeLexiconData;
  const prevDict = ((activeLexiconData["zh-TW"] || {}) as Record<string, string>);
  if (prevDict[key]) {
    const nextDict = { ...prevDict };
    delete nextDict[key];
    storyboardStore.setLexiconData({ ...activeLexiconData, "zh-TW": nextDict });
    renderLexiconTable();
    showToast(`🗑️ 已刪除發音規則：${key}`);
  }
}

export async function savePronunciationLexiconToBackend(): Promise<void> {
  try {
    const res = await fetch(`${LOCAL_DAEMON_BASE_URL}/api/lexicon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lexicon: storyboardStore.getState().activeLexiconData }),
    });
    if (res.ok) {
      showToast("💾 發音詞庫已成功儲存至 configs/pronunciation_lexicon.json");
      closePronunciationLexiconModal();
      updatePhoneticBadgesInCards();
    } else {
      showToast("⚠️ 儲存失敗，請檢查後端日誌");
    }
  } catch (err) {
    console.debug("Lexicon save offline fallback:", err);
    showToast("💡 離線模式：已於前端暫存發音詞庫");
    closePronunciationLexiconModal();
    updatePhoneticBadgesInCards();
  }
}

export function updatePhoneticBadgesInCards(): void {
  const cards = document.querySelectorAll("#segmentsContainer .segment-card");
  cards.forEach((card) => {
    const dial = card.querySelector<HTMLInputElement>(".seg-dialogue-input")?.value || "";
    const badge = card.querySelector(".seg-phonetic-badge");
    if (badge) badge.innerHTML = renderPhoneticHintBadge(dial);
  });
}

export function runFullProjectPhoneticsAudit(): void {
  const cards = document.querySelectorAll("#segmentsContainer .segment-card");
  const resultsEl = document.getElementById("lexiconAuditResults");
  const summaryEl = document.getElementById("lexiconAuditSummary");
  if (!cards.length) {
    showToast("⚠️ 目前無分鏡段落，無法執行體檢");
    return;
  }

  const dict = ((storyboardStore.getState().activeLexiconData["zh-TW"] || {}) as Record<string, string>);
  let hitCount = 0;
  const reportItems: string[] = [];

  cards.forEach((card, idx) => {
    const text = card.querySelector<HTMLInputElement>(".seg-dialogue-input")?.value || "";
    const matched = Object.keys(dict).filter((k) => text.includes(k));
    if (matched.length > 0) {
      hitCount += matched.length;
      reportItems.push(`
            <div style="padding:6px 0; border-bottom:1px solid #1e293b;">
              <span style="color:#7dd3fc; font-weight:600;">Part ${idx + 1}：</span>
              <span>「${escapeHtml(text)}」</span>
              <div style="color:#fde68a; font-size:0.75rem; margin-top:2px;">
                ➔ 命中唯一發音替換：${matched.map((k) => `<b>${escapeHtml(k)}</b> 轉為 <b>${escapeHtml(dict[k])}</b>`).join("、")}
              </div>
            </div>
          `);
    }
  });

  if (resultsEl) {
    resultsEl.style.display = "block";
    if (reportItems.length > 0) {
      resultsEl.innerHTML = reportItems.join("");
      if (summaryEl) summaryEl.textContent = `⚡ 掃描完成：共命中 ${hitCount} 處破音字規則`;
    } else {
      resultsEl.innerHTML = `<span style="color:#10b981;">🎉 全片無多音歧義字詞，發音平穩！</span>`;
      if (summaryEl) summaryEl.textContent = "✅ 全數通過";
    }
  }
}
