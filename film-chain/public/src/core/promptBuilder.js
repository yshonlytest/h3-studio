/**
 * H3 Storyboard Studio - promptBuilder.js
 * 純邏輯：導演 System Prompt 建立、首尾連貫提示詞檢查、對白標籤提取與 JSON 清理
 */
(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    root.H3PromptBuilder = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CONTINUITY_PHRASE = "Create a 5-second live-action cinematic film continuing seamlessly from the exact last frame, pose, camera angle, and lighting of the previous segment";
  const DEFAULT_SEGMENT_DURATION_SECONDS = 5;

  /**
   * 建立 AI 導演的分鏡系統指令 (System Instruction)
   * @param {"auto" | "expand"} durationMode - 時長模式 (自適應評估 或 強制展開指定秒數)
   * @param {number} targetSeconds - 目標秒數 (例如 15、20、30)
   * @returns {string} 完整的導演系統指令
   */
  function buildDirectorSystemPrompt(durationMode, targetSeconds, paradigm = "latent_chain") {
    const sec = Math.max(DEFAULT_SEGMENT_DURATION_SECONDS, targetSeconds || 15);
    const count = Math.max(1, Math.round(sec / DEFAULT_SEGMENT_DURATION_SECONDS));

    const durationInstruction = durationMode === "expand"
      ? `The user explicitly requested a total video duration of ${sec} seconds (${count} segments of 5 seconds each). You MUST expand, enrich, and pace the user's Chinese story into a rich, unhurried ${sec}-second screenplay consisting of exactly ${count} sequential 5-second segments!`
      : `Analyze the user's Chinese story complexity, actions, and dialogue length, and freely determine the optimal total duration in seconds (must be a multiple of 5, e.g., 5, 10, 15, 20, 25, 30, etc. — do NOT artificially cap at 15s if the plot needs 20s or 25s!). Create N = recommended_total_seconds / 5 sequential 5-second segments so no segment feels rushed.`;

    const chainInstruction = paradigm === "grid_keyframes"
      ? `Each segment uses keyframe anchoring ("chain_mode": "first_frame").`
      : `Segment 1 uses "chain_mode": "first_frame", and Segments 2..N MUST use "chain_mode": "motion_context" (PR #76 lossless latent continuation without static anchor_reset jumps).`;

    return `You are an expert AI Film Director specializing in First/Last-Frame Chained Video Generation and 5D Context-IR Prompt Engineering.
The user provides a character/setting reference image and a creative story description in Chinese.

YOUR TASKS & WORKFLOW:
1. ${durationInstruction}
2. 3x3 Storyboard Contact Sheet (9 Key Milestones):
   - Plan a 3x3 nine-panel photo grid (Panel 1 to Panel 9, read left-to-right, top-to-bottom: Row 1 = Panels 1, 2, 3; Row 2 = Panels 4, 5, 6; Row 3 = Panels 7, 8, 9).
   - Write \`grid_image_prompt\` in English to generate this 3x3 photo grid (thin white lines only, strictly NO text, NO captions, NO subtitles anywhere in image) maintaining exact character identity and scene atmosphere from the reference image.
3. Sequential 5-Second Segments (5D Context-IR Chained Storyboard Video Prompts):
   - ${chainInstruction}
   - For EACH segment (Segment 1 to Segment N):
     A. \`title\` (Chinese Milestone Summary): MUST be in Traditional Chinese (繁體中文), stating the part number, timecode, and a clear story milestone summary (e.g., "Part 1 (0-5s): 裂空急墜・雲海截殺").
     B. \`end_panel\`: The target milestone panel index in the 3x3 grid (integer from 1 to 9, monotonically increasing from Segment 1 up to 9 on the final segment).
     C. \`chain_mode\`: "first_frame" for Segment 1, and "${paradigm === "grid_keyframes" ? "first_frame" : "motion_context"}" for Segments 2..N.
     D. \`context_ir\`: Structured 5-dimension object \`{ "scene": "...", "camera": "...", "action": "0-2.5s: ... 2.5-5.0s: ...", "look": "...", "audio": "..." }\`.
     E. \`prompt\` (English 5D Cinematic Video Prompt): High-density English prompt compiled from the 5D Context-IR:
        - STRICT SEAMLESS CONTINUITY:
          * Segment 1 (0-5s): Establish the character and environment from Panel 1.
          * Segment 2 to N: MUST explicitly start with: "${CONTINUITY_PHRASE}." and re-state core character facial/costume visual anchors in text to prevent identity drift without resetting frames.
        - 5D Tag Format: Explicitly structure the prompt with \`[Scene] ... [Camera] ... Timeline: 0-2.5s: ... 2.5-5.0s: ... [Look] ... Audio: ...\`.
        - Chinese Spoken Dialogue: If the segment includes speech, embed \`<d>[Chinese] 台詞內容</d>\` inside BOTH the \`Timeline:\` action and \`Audio:\` section for lip-sync and Mandarin speech synthesis.

Return ONLY valid JSON matching this schema:
{
  "project_slug": "short_english_slug",
  "recommended_total_seconds": 25,
  "reasoning_zh": "繁體中文說明：為什麼評估此秒數最適合，以及如何鋪陳起承轉合與潛空間接力",
  "expanded_story_zh": "擴寫後的完整繁體中文分鏡故事大綱",
  "grid_image_prompt": "A seamless 3x3 nine-panel photo grid...",
  "segments": [
    {
      "title": "Part 1 (0-5s): 繁體中文段落標題與情節說明",
      "end_panel": 2,
      "chain_mode": "first_frame",
      "context_ir": {
        "scene": "Environment description",
        "camera": "Dynamic tracking shot description",
        "action": "0-2.5s: Opening movement. 2.5-5.0s: Follow-up action and <d>[Chinese] 台詞</d>",
        "look": "Lighting, lens, and cloth physics",
        "audio": "Ambient foley and spoken dialogue: <d>[Chinese] 台詞</d>"
      },
      "prompt": "[Scene] ... [Camera] ... Timeline: 0-2.5s: ... 2.5-5.0s: ... [Look] ... Audio: ... <d>[Chinese] 台詞</d>."
    }
  ]
}`;
  }

  /**
   * 確保第 2 段 (index >= 1) 及之後的分鏡 Prompt 開頭具有強制連貫前綴
   * @param {number} segmentIndex - 0-based
   * @param {string} promptText - 原始 Prompt
   * @returns {string} 具備首尾連貫句式的 Prompt
   */
  function ensureContinuityPrefix(segmentIndex, promptText) {
    const raw = (promptText || "").trim();
    if (segmentIndex <= 0) return raw;

    const lower = raw.toLowerCase();
    if (lower.startsWith("create a 5-second live-action cinematic film continuing seamlessly") ||
        lower.includes("continuing seamlessly from the exact last frame")) {
      return raw;
    }

    return `${CONTINUITY_PHRASE}, ${raw.replace(/^(create\s+a\s+5-second\s+video|in\s+this\s+clip|this\s+segment)\s*,?\s*/i, "")}`;
  }

  /**
   * 將中文台詞包裹為 H3/Seedance 對白口型標籤
   * @param {string} chineseDialogue - 台詞
   * @returns {string} `<d>[Chinese] ...</d>`
   */
  function wrapDialogueTag(chineseDialogue) {
    const clean = (chineseDialogue || "").trim();
    if (!clean) return "";
    return `<d>[Chinese] ${clean}</d>`;
  }

  /**
   * 從 Prompt 字串中提取所有對白標籤
   * @param {string} promptText - 提示詞文字
   * @returns {string[]} 提取到的對白清單
   */
  function extractDialogueTags(promptText) {
    if (!promptText) return [];
    const regex = /<d>\[Chinese\]\s*(.*?)\s*<\/d>/g;
    const matches = [];
    let match;
    while ((match = regex.exec(promptText)) !== null) {
      if (match[1]) matches.push(match[1]);
    }
    return matches;
  }

  /**
   * 清理 LLM 回傳的 Markdown 代碼標籤或引言並安全解析為 JSON 物件
   * @param {string} rawText - 原始回傳文字
   * @returns {any} 解析後的 JSON 物件
   */
  function cleanAndParseJson(rawText) {
    if (!rawText || typeof rawText !== "string") {
      throw new Error("無效的 JSON 原始文字輸入");
    }

    // 1. 優先嘗試擷取 ```json ... ``` 或 ``` ... ``` 區塊
    const codeBlockMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    let content = codeBlockMatch ? codeBlockMatch[1].trim() : rawText.trim();

    // 嘗試直接解析
    try {
      return JSON.parse(content);
    } catch (_) {
      // 容錯提取：若包含前後雜訊或說明文字
    }

    // 2. 優先嘗試截取最外層 JSON 物件 { ... }
    const firstBrace = content.indexOf('{');
    const lastBrace = content.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(content.substring(firstBrace, lastBrace + 1));
      } catch (_) {
        // 若物件候選字串解析失敗，繼續嘗試陣列
      }
    }

    // 3. 嘗試截取最外層 JSON 陣列 [ ... ]
    const firstBracket = content.indexOf('[');
    const lastBracket = content.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      try {
        return JSON.parse(content.substring(firstBracket, lastBracket + 1));
      } catch (_) {
        // 陣列候選字串解析失敗
      }
    }

    return JSON.parse(content);
  }

  /**
   * 將 Context-IR 五維度物件組合為 H3 規範的提示詞字串
   * @param {{ scene?: string, action?: string, camera?: string, look?: string, audio?: string }} fields
   * @param {number} [segmentIndex=0]
   * @returns {string}
   */
  function compileContextIR(fields, segmentIndex = 0) {
    const f = fields || {};
    const parts = [];
    if (f.scene && f.scene.trim()) parts.push(`[Scene] ${f.scene.trim()}.`);
    if (f.camera && f.camera.trim()) parts.push(`[Camera] ${f.camera.trim()}.`);
    if (f.action && f.action.trim()) parts.push(`Timeline: ${f.action.trim()}.`);
    if (f.look && f.look.trim()) parts.push(`[Look] ${f.look.trim()}.`);
    if (f.audio && f.audio.trim()) parts.push(`Audio: ${f.audio.trim()}.`);
    const compiled = parts.join(' ').trim();
    return ensureContinuityPrefix(segmentIndex, compiled);
  }

  /**
   * 從既有 Prompt 字串反解析出 5D Context-IR 欄位（供 UI 五維度抽屜預填）
   * @param {string} promptText
   * @returns {{ scene: string, camera: string, action: string, look: string, audio: string }}
   */
  function parseContextIRFromPrompt(promptText) {
    const raw = (promptText || "").trim();
    const extract = (pattern) => {
      const m = raw.match(pattern);
      return m && m[1] ? m[1].trim().replace(/\.$/, "") : "";
    };
    return {
      scene: extract(/\[Scene\]\s*([\s\S]*?)(?=\[Camera\]|Timeline:|\[Look\]|Audio:|$)/i),
      camera: extract(/\[Camera\]\s*([\s\S]*?)(?=\[Scene\]|Timeline:|\[Look\]|Audio:|$)/i),
      action: extract(/Timeline:\s*([\s\S]*?)(?=\[Scene\]|\[Camera\]|\[Look\]|Audio:|$)/i),
      look: extract(/\[Look\]\s*([\s\S]*?)(?=\[Scene\]|\[Camera\]|Timeline:|Audio:|$)/i),
      audio: extract(/Audio:\s*([\s\S]*?)(?=\[Scene\]|\[Camera\]|Timeline:|\[Look\]|$)/i),
    };
  }

  /**
   * 2D Staging Board 頂視角幾何運鏡編譯器（通用層：本地與雲端模型皆可用）
   * @param {{ start: {x:number, y:number}, end: {x:number, y:number}, subject: {x:number, y:number} }} track
   * @returns {string} 電影級運鏡英語提示詞
   */
  function compileCameraTrack(track) {
    if (!track || !track.start || !track.end || !track.subject) {
      return "static camera keeping the subject tightly framed";
    }
    const dxCam = track.end.x - track.start.x;
    const distStart = Math.hypot(track.start.x - track.subject.x, track.start.y - track.subject.y);
    const distEnd = Math.hypot(track.end.x - track.subject.x, track.end.y - track.subject.y);
    const dDist = distEnd - distStart;

    const descriptors = [];
    if (dDist < -0.08) {
      descriptors.push("smooth dolly-in movement towards the subject");
    } else if (dDist > 0.08) {
      descriptors.push("smooth pull-back movement away from the subject");
    }

    if (dxCam > 0.1) {
      descriptors.push("rightward tracking motion");
    } else if (dxCam < -0.1) {
      descriptors.push("leftward tracking motion");
    }

    const angleStart = Math.atan2(track.start.y - track.subject.y, track.start.x - track.subject.x);
    const angleEnd = Math.atan2(track.end.y - track.subject.y, track.end.x - track.subject.x);
    const dAngle = angleEnd - angleStart;
    if (Math.abs(dAngle) > 0.25) {
      const orbitDir = dAngle > 0 ? "clockwise" : "counter-clockwise";
      descriptors.push(`${orbitDir} arcing orbital camera move`);
    }

    if (descriptors.length === 0) {
      return "static camera keeping the subject tightly framed";
    }
    return `cinematic ${descriptors.join(", and ")}, maintaining the subject in sharp focus`;
  }

  return {
    CONTINUITY_PHRASE,
    buildDirectorSystemPrompt,
    ensureContinuityPrefix,
    wrapDialogueTag,
    extractDialogueTags,
    cleanAndParseJson,
    compileContextIR,
    parseContextIRFromPrompt,
    compileCameraTrack
  };
});
