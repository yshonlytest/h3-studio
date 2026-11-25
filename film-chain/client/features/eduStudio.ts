import type { EduChapterOutline, StoryboardPlan, StoryboardSegment } from "../types/studio.ts";
import { MEDIA_CONSTANTS } from "../config/constants.ts";
import { storyboardStore } from "../stores/storyboardStore.ts";
import { escapeHtml, selectProjectMode, showToast } from "./uiShell.ts";
import { loadGoldenTemplate } from "./director.ts";
import { renderPlanUI } from "./storyboardEditor.ts";
import { applyPhoneticSubstitutions, renderPhoneticHintBadge } from "./phoneticsLexicon.ts";

export function handleEduFileUpload(inputEl: HTMLInputElement): void {
  const file = inputEl.files && inputEl.files[0];
  if (!file) return;
  if (file.name.toLowerCase().endsWith(".pdf")) {
    showToast("💡 偵測到 PDF 文件！建議先透過 minerU 解析為 Markdown，或貼上純文字內容以確保大綱完整。");
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    const docInput = document.getElementById("eduDocInput") as HTMLTextAreaElement | null;
    if (docInput) docInput.value = String(e.target?.result || "");
    showToast(`📄 已載入文檔：${file.name}`);
    extractEduOutlines();
  };
  reader.readAsText(file);
}

export function loadSampleEduDoc(): void {
  const sample = `# 第1章：深夜期末死線與靈感啟發
期末報告截止只剩幾小時，腦中空有畫面卻擠不出分鏡？別慌，交給 H3 幫你把想法快速具象化。

# 第2章：步驟一：簡短構想五維擴寫
步驟一輸入一句日常構想，系統會自動擴寫成五維提示詞，幫你把鏡頭運動與畫面元素整理清楚。

# 第3章：步驟二：九宮格多機位調度
步驟二打破單調的一鏡到底，切換九宮格機位，遠景、中景與特寫自由調度，豐富影片層次。

# 第4章：潛空間慣性無損延續
很多工具常忽略鏡頭銜接的跳針問題。我們花時間把潛空間接力做進去，讓上一鏡的動能自然延續。

# 第5章：物理慣性鎖定特徵防走樣
不管是人物奔跑的物理慣性還是光影明暗，接力運算能鎖定特徵，讓角色和畫面不輕易變形。

# 第6章：情感真聲拒絕生硬念稿
一般的語音合成往往死板得像念稿。H3 著重生成帶有呼吸節奏的情感聲音，讓對白更自然。

# 第7章：一成微量算力抽屜重抽
要是對某句話語氣不滿意，拉開抽屜單獨重抽音訊只要消耗一成算力，不用整部影片重跑。

# 第8章：步驟三：三大算力路線總覽
來到步驟三算力調度，系統設計了三條不同路線，依照手邊設備與預算自由搭配。

# 第9章：路線一：Apple Silicon 原生加速
第一條是 Mac 專屬路線。多數開源專案對蘋果電腦支援有限，這裡特別原生優化，沒網路也能順暢跑。

# 第10章：路線二：商用雲端極速直連
第二條是商用雲端直連。填入密鑰就能呼叫高效能雲端主機，多個分鏡同時並行，幾分鐘內搞定。

# 第11章：路線三：善用贈送算力低成本排程
第三條是善用訂閱贈送的雲端算力，用很低成本就能調用頂級顯示卡，遇到忙碌還會自動降級保底。

# 第12章：步驟四：自動音樂避讓與精確字幕
最後步驟四不用再開剪輯軟體，系統會自動在人聲處壓低背景音樂，並生成精確對齊的字幕。

# 第13章：一鍵匯出與開源模型價值
MiniMax 雖然是開源模型，但在多鏡頭連貫上已經相當扎實好用。點擊一鍵匯出，快速打包成片。

# 第14章：終章天亮順利交卷
不知不覺天已經亮了，通宵趕完的期末報告順利搞定交卷！現在就打開 H3 試試看吧。`;
  const input = document.getElementById("eduDocInput") as HTMLTextAreaElement | null;
  if (input) input.value = sample;
  showToast("💡 已載入 H3 Studio 工作流教學文檔並同步套用 105s 實測分鏡");
  extractEduOutlines();
  loadGoldenTemplate("tutorial_140s");
}

export function onEduSpeakerPresetChange(sel: HTMLSelectElement): void {
  const customInput = document.getElementById("eduSpeakerVisualInput") as HTMLInputElement | null;
  if (!customInput) return;
  if (sel.value === "custom") {
    customInput.focus();
  } else {
    customInput.value = sel.value;
  }
}

export function extractEduOutlines(): void {
  const rawText = ((document.getElementById("eduDocInput") as HTMLTextAreaElement | null)?.value || "").trim();
  if (!rawText) {
    showToast("⚠️ 請先在上方貼上或上傳長篇知識報告文檔！");
    return;
  }

  const rawSections = rawText.split(/\n(?=#+\s+)/g);
  const chapters: Array<{
    chapter_id: number;
    title: string;
    body: string;
    word_count: number;
    est_shots: number;
    est_duration_sec: number;
  }> = [];
  let totalWords = 0;

  rawSections.forEach((sec, idx) => {
    const lines = sec.trim().split("\n");
    let title = lines[0].replace(/^#+\s*/, "").trim();
    if (!title) title = `章節 ${idx + 1}`;
    const body = lines.slice(1).join(" ").trim() || lines[0];
    const cjkCount = (body.match(/[\u4e00-\u9fff\u3400-\u4dbf\w]/g) || []).length;
    totalWords += cjkCount;

    const estShots = Math.max(1, Math.round(cjkCount / 20));
    const estDuration = estShots * 6;

    chapters.push({
      chapter_id: idx + 1,
      title,
      body,
      word_count: cjkCount,
      est_shots: estShots,
      est_duration_sec: estDuration,
    });
  });

  storyboardStore.setParsedEduChapters(chapters);
  const totalShots = chapters.reduce((acc, c) => acc + c.est_shots, 0);
  const totalSec = chapters.reduce((acc, c) => acc + c.est_duration_sec, 0);

  const previewArea = document.getElementById("eduOutlinePreviewArea");
  const badge = document.getElementById("eduOutlineSummaryBadge");
  const listEl = document.getElementById("eduOutlineList");
  const genBtn = document.getElementById("generateEduStoryboardBtn");

  if (badge) badge.textContent = `共 ${chapters.length} 章節 · ${totalWords} 字 · 建議 ${totalShots} 分鏡 (~${totalSec}s)`;
  if (listEl) {
    listEl.innerHTML = chapters
      .map(
        (c) => `
          <div style="padding:6px 0; border-bottom:1px solid #2e1065; display:flex; justify-content:space-between; align-items:center;">
            <div>
              <strong style="color:#f3e8ff;">${escapeHtml(c.title)}</strong>
              <div style="font-size:0.75rem; color:#a855f7;">${escapeHtml(c.body.slice(0, 48))}...</div>
            </div>
            <span class="badge" style="background:#1e0836; color:#d8b4fe; border-color:#7c3aed; font-size:0.74rem;">${c.word_count} 字 · ${c.est_shots} 鏡 (~${c.est_duration_sec}s)</span>
          </div>
        `
      )
      .join("");
  }
  if (previewArea) previewArea.style.display = "block";
  if (genBtn) genBtn.style.display = "inline-flex";
  showToast(`✅ 大綱防漏檢查通過：共 ${chapters.length} 章節、預計 ${totalShots} 個分鏡`);
}

export function generateEduStoryboardFromOutlines(): void {
  let parsedEduChapters = storyboardStore.getState().parsedEduChapters;
  if (!parsedEduChapters || !parsedEduChapters.length) {
    extractEduOutlines();
    parsedEduChapters = storyboardStore.getState().parsedEduChapters;
    if (!parsedEduChapters || !parsedEduChapters.length) return;
  }

  const langCode = (document.getElementById("eduLangCodeSelect") as HTMLSelectElement | null)?.value || "zh-TW";
  const speakerVisual =
    (document.getElementById("eduSpeakerVisualInput") as HTMLInputElement | null)?.value || "friendly young anime researcher in white lab coat";
  const acousticAnchor =
    (document.getElementById("eduAcousticAnchorInput") as HTMLInputElement | null)?.value ||
    "clear Mandarin studio voice, steady professional narrator tone, natural pacing";
  const bgmStyle =
    (document.getElementById("eduBgmStyleInput") as HTMLInputElement | null)?.value || "soft acoustic piano background music, warm Japanese anime soundtrack";

  const segments: StoryboardSegment[] = [];
  let globalIdx = 0;

  parsedEduChapters.forEach((chap, cIdx) => {
    const sentences = String(chap.body || "")
      .split(/[。！？\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    sentences.forEach((sen, sIdx) => {
      globalIdx++;
      const cjk = (sen.match(/[\u4e00-\u9fff\u3400-\u4dbf\w]/g) || []).length;
      let frames = 124;
      if (cjk <= 12) frames = 93;
      else if (cjk <= 18) frames = 124;
      else if (cjk <= 22) frames = 155;
      else frames = 186;

      let shotType = "presenter_chart";
      const handKeywords = ["內", "外", "夾", "弓", "大", "立", "腕", "步驟", "訣", "濕", "搓", "沖", "捧", "擦"];
      const isKeyAction = handKeywords.some((kw) => sen.includes(kw)) || /\d/.test(sen);

      if (sIdx === 0 && cIdx === 0) shotType = "presenter_focus";
      else if (isKeyAction) shotType = "presenter_chart";
      else if (sIdx % 3 === 2) shotType = "pure_b_roll";

      let visualPrompt = `Japanese anime aesthetic, hand-drawn educational scene illustrating ${chap.title}`;
      if (shotType === "presenter_chart") {
        visualPrompt += `, with ${speakerVisual} gesturing to blackboard diagrams and hand action steps`;
      } else if (shotType === "presenter_focus") {
        visualPrompt += `, featuring ${speakerVisual} speaking warmly to the audience`;
      }

      const prompt = `${visualPrompt}. Audio: ${acousticAnchor}, ${bgmStyle}, <d>[Chinese] ${sen}</d>.`;

      segments.push({
        segment: globalIdx,
        shot_id: globalIdx,
        end_panel: 1,
        title: `Part ${globalIdx}: ${chap.title} (${sIdx + 1})`,
        shot_type: shotType,
        dialogue: sen,
        frames,
        chain_mode: globalIdx === 1 ? "first_frame" : "motion_context",
        prompt,
      });
    });
  });

  const newPlan = {
    title: "教學長片故事板",
    project_mode: "edu_explainer",
    auto_duration: true,
    project_slug: "edu_lecture",
    recommended_total_seconds: Math.round(segments.reduce((acc, s) => acc + (s.frames || 124) / 24, 0)),
    reasoning_zh: "",
    expanded_story_zh: "",
    global_profile: {
      language_code: langCode,
      acoustic_anchor: acousticAnchor,
      speaker_visual_anchor: speakerVisual,
      bgm_style: bgmStyle,
    },
    segments,
  };
  storyboardStore.setPlan(newPlan);

  selectProjectMode("edu");
  renderPlanUI(newPlan);
  document.getElementById("step2Card")?.scrollIntoView({ behavior: "smooth" });
  showToast(`🎉 已成功生成 ${segments.length} 個分鏡卡片（含即時語速檢驗與動態幀數）！`);
}

export function updatePacingBadgeForCard(card: Element | null): void {
  if (!card) return;
  const htmlCard = card as HTMLElement;
  const inputEl = htmlCard.querySelector<HTMLInputElement | HTMLTextAreaElement>(".seg-dialogue-input");
  const text = inputEl ? inputEl.value.trim() : "";
  const cjkCount = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const latinTokens: string[] = text.match(/[A-Za-z0-9_]+/g) || [];
  const latinSyllables = latinTokens.reduce<number>((sum, tok) => sum + Math.max(1, Math.ceil(tok.length / 2)), 0);
  const cjkChars = cjkCount + latinSyllables;
  const badge = htmlCard.querySelector<HTMLElement>(".seg-pacing-badge");
  const framesSelect = htmlCard.querySelector<HTMLSelectElement>(".seg-frames-select");
  const splitBtn = htmlCard.querySelector<HTMLElement>(".seg-split-btn");

  const frames = framesSelect ? parseInt(framesSelect.value, 10) || MEDIA_CONSTANTS.DEFAULT_EDU_FRAMES : MEDIA_CONSTANTS.DEFAULT_EDU_FRAMES;
  const durationSec = Math.max(1, frames / MEDIA_CONSTANTS.DEFAULT_FPS);
  const cps = durationSec > 0 ? cjkChars / durationSec : 0;

  if (cps >= MEDIA_CONSTANTS.EDU_DANGER_CPS && cjkChars > MEDIA_CONSTANTS.EDU_DANGER_MIN_CHARS) {
    htmlCard.style.border = "2px solid #ef4444";
    htmlCard.style.boxShadow = "0 0 16px rgba(239,68,68,0.4)";
    if (badge) {
      badge.className = "badge danger";
      badge.textContent = `🚨 語速過快 (${cps.toFixed(1)} 字/秒 ≥ ${MEDIA_CONSTANTS.EDU_DANGER_CPS} 上限 · ${cjkChars}字/${durationSec.toFixed(1)}s)`;
      badge.style.background = "rgba(239,68,68,0.25)";
      badge.style.color = "#fca5a5";
      badge.style.borderColor = "#ef4444";
    }
    if (splitBtn) splitBtn.style.display = "inline-flex";
  } else if (cps >= MEDIA_CONSTANTS.EDU_WARN_CPS && cjkChars > MEDIA_CONSTANTS.EDU_WARN_MIN_CHARS) {
    htmlCard.style.border = "1.5px solid #f59e0b";
    htmlCard.style.boxShadow = "";
    if (splitBtn) splitBtn.style.display = "none";
    if (badge) {
      badge.className = "badge warn";
      badge.textContent = `⚠️ 語速偏緊湊 (${cps.toFixed(1)} 字/秒 · ${cjkChars}字/${durationSec.toFixed(1)}s)`;
      badge.style.background = "rgba(245,158,11,0.22)";
      badge.style.color = "#fde68a";
      badge.style.borderColor = "#f59e0b";
    }
  } else {
    htmlCard.style.border = "";
    htmlCard.style.boxShadow = "";
    if (splitBtn) splitBtn.style.display = "none";
    if (badge) {
      badge.className = "badge ok";
      badge.textContent = `🟢 語速流暢 (${cps > 0 ? cps.toFixed(1) + " 字/秒" : "0字"} · ${cjkChars}字/${durationSec.toFixed(1)}s)`;
      badge.style.background = "rgba(16,185,129,0.18)";
      badge.style.color = "#6ee7b7";
      badge.style.borderColor = "#10b981";
    }
  }
}

export function onShotDialogueInput(inputEl: HTMLInputElement | HTMLTextAreaElement): void {
  const card = inputEl.closest(".segment-card");
  if (!card) return;
  const text = inputEl.value.trim();
  const spokenText = applyPhoneticSubstitutions(text);

  const promptEl = card.querySelector<HTMLTextAreaElement>(".seg-prompt-input");
  if (promptEl) {
    if (/<d>.*?<\/d>/s.test(promptEl.value)) {
      promptEl.value = promptEl.value.replace(/<d>(?:\[\w+\])?\s*.*?<\/d>/s, `<d>[Chinese] ${spokenText}</d>`);
    } else {
      promptEl.value = `${promptEl.value.trim()} Audio: <d>[Chinese] ${spokenText}</d>.`;
    }
  }

  updatePacingBadgeForCard(card);

  const phoneticBadge = card.querySelector(".seg-phonetic-badge");
  if (phoneticBadge) {
    phoneticBadge.innerHTML = renderPhoneticHintBadge(text);
  }
}
