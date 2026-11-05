/**
 * H3 Storyboard Studio - audioStudio.js
 * 純邏輯：台詞解析、時碼推算、SRT/VTT 字幕生成、語音合成 (TTS) 與多軌混音排程
 */
(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    root.H3AudioStudio = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SEGMENT_DURATION = 5; // 每鏡段固定 5 秒

  /**
   * 從 Prompt 或故事腳本中精準抽取對白文字與時碼提示
   * @param {string} prompt - 鏡段英文/中文 Prompt
   * @param {number} partIndex - 鏡段索引 (0-based)
   * @returns {{ text: string, startOffsetSec: number, durationSec: number }}
   */
  function extractDialogueInfo(prompt, partIndex = 0) {
    if (!prompt || typeof prompt !== 'string') {
      return { text: '', startOffsetSec: 1.5, durationSec: 2.5 };
    }

    let text = '';
    let startOffsetSec = 1.5;
    let durationSec = 2.5;

    // 1. 抽取 <d>[Chinese] 對白 </d> 或 <d> 對白 </d>
    const dMatch = prompt.match(/<d>(?:\[Chinese\])?\s*([^<]+)<\/d>/i);
    if (dMatch && dMatch[1]) {
      text = dMatch[1].trim();
    } else {
      // 2. 抽取中文引號「...」
      const quoteMatch = prompt.match(/「([^」]+)」/);
      if (quoteMatch && quoteMatch[1]) {
        text = quoteMatch[1].trim();
      }
    }

    // 3. 嘗試在 timeline 語境中尋找該句對白的時碼 (例如 3.0-5.0s 或 2.5-4.5s)
    if (text) {
      const escapedText = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const timeLineRegex = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*-\\s*(\\d+(?:\\.\\d+)?)s?[^\\n]*?${escapedText}`, 'i');
      const tlMatch = prompt.match(timeLineRegex);
      if (tlMatch && tlMatch[1] && tlMatch[2]) {
        const start = parseFloat(tlMatch[1]);
        const end = parseFloat(tlMatch[2]);
        if (!isNaN(start) && !isNaN(end) && end > start && start < SEGMENT_DURATION) {
          startOffsetSec = Math.max(0, Math.min(SEGMENT_DURATION - 0.5, start));
          durationSec = Math.max(1.0, Math.min(SEGMENT_DURATION - startOffsetSec, end - start));
        }
      }
    }

    return {
      text,
      startOffsetSec: parseFloat(startOffsetSec.toFixed(2)),
      durationSec: parseFloat(durationSec.toFixed(2)),
    };
  }

  /**
   * 將秒數格式化為 SRT 標準時間戳 (00:00:00,000)
   * @param {number} totalSeconds
   * @returns {string}
   */
  function formatTimecodeSrt(totalSeconds) {
    const sec = Math.max(0, totalSeconds || 0);
    const totalMs = Math.round(sec * 1000);
    const ms = totalMs % 1000;
    const totalSecs = Math.floor(totalMs / 1000);
    const secs = totalSecs % 60;
    const mins = Math.floor((totalSecs % 3600) / 60);
    const hrs = Math.floor(totalSecs / 3600);

    const pad = (n, len = 2) => String(n).padStart(len, '0');
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)},${pad(ms, 3)}`;
  }

  /**
   * 將秒數格式化為 WebVTT 標準時間戳 (00:00:00.000)
   * @param {number} totalSeconds
   * @returns {string}
   */
  function formatTimecodeVtt(totalSeconds) {
    return formatTimecodeSrt(totalSeconds).replace(',', '.');
  }

  /**
   * 生成標準 SRT 字幕檔內容
   * @param {Array<{ partIndex: number, text: string, startOffsetSec?: number, durationSec?: number }>} items
   * @returns {string}
   */
  function generateSrt(items = []) {
    const validItems = items.filter(it => it && it.text && it.text.trim());
    if (!validItems.length) return '';

    return validItems.map((item, idx) => {
      const partIdx = typeof item.partIndex === 'number' ? item.partIndex : idx;
      const baseSec = partIdx * SEGMENT_DURATION;
      const offset = typeof item.startOffsetSec === 'number' ? item.startOffsetSec : 1.5;
      const dur = typeof item.durationSec === 'number' ? item.durationSec : 2.5;

      const startSec = baseSec + offset;
      const endSec = Math.min(baseSec + SEGMENT_DURATION, startSec + dur);

      return `${idx + 1}\n${formatTimecodeSrt(startSec)} --> ${formatTimecodeSrt(endSec)}\n${item.text.trim()}\n`;
    }).join('\n');
  }

  /**
   * 生成標準 WebVTT 字幕檔內容
   * @param {Array<{ partIndex: number, text: string, startOffsetSec?: number, durationSec?: number }>} items
   * @returns {string}
   */
  function generateVtt(items = []) {
    const validItems = items.filter(it => it && it.text && it.text.trim());
    if (!validItems.length) return 'WEBVTT\n\n';

    const entries = validItems.map((item, idx) => {
      const partIdx = typeof item.partIndex === 'number' ? item.partIndex : idx;
      const baseSec = partIdx * SEGMENT_DURATION;
      const offset = typeof item.startOffsetSec === 'number' ? item.startOffsetSec : 1.5;
      const dur = typeof item.durationSec === 'number' ? item.durationSec : 2.5;

      const startSec = baseSec + offset;
      const endSec = Math.min(baseSec + SEGMENT_DURATION, startSec + dur);

      return `${idx + 1}\n${formatTimecodeVtt(startSec)} --> ${formatTimecodeVtt(endSec)}\n${item.text.trim()}\n`;
    }).join('\n');

    return `WEBVTT\n\n${entries}`;
  }

  /**
   * 計算 Audio Ducking（對白閃避）時間區間
   * @param {Array<{ partIndex: number, startOffsetSec?: number, durationSec?: number }>} dialogues
   * @returns {Array<{ start: number, end: number }>}
   */
  function calculateDuckingRanges(dialogues = []) {
    return dialogues
      .filter(d => d && d.text && d.text.trim())
      .map(d => {
        const base = (d.partIndex || 0) * SEGMENT_DURATION;
        const offset = typeof d.startOffsetSec === 'number' ? d.startOffsetSec : 1.5;
        const dur = typeof d.durationSec === 'number' ? d.durationSec : 2.5;
        const start = Math.max(0, base + offset - 0.2); // 說話前 0.2s 開始漸降
        const end = base + offset + dur + 0.3;          // 說話後 0.3s 恢復
        return { start, end };
      });
  }

  // ==================== 程式化免版權風格 BGM 合成器 ====================
  /**
   * 使用 Web Audio API 程式化合成循環氛圍襯樂 (無需下載外部檔案)
   * @param {AudioContext} audioCtx
   * @param {'fantasy'|'lively'|'cozy'|'suspense'} style
   * @param {number} totalSeconds
   * @returns {AudioBuffer}
   */
  function generateProceduralBgmBuffer(audioCtx, style = 'fantasy', totalSeconds = 15) {
    if (!audioCtx) return null;

    const sampleRate = audioCtx.sampleRate;
    const length = Math.floor(sampleRate * totalSeconds);
    const audioBuffer = audioCtx.createBuffer(2, length, sampleRate);
    const left = audioBuffer.getChannelData(0);
    const right = audioBuffer.getChannelData(1);

    // 針對不同風格設定音階基頻 (Hz)
    let chordFreqs = [220, 277.18, 329.63, 440]; // A major
    let moodSpeed = 1.0;
    let warmth = 0.8;

    if (style === 'lively') {
      chordFreqs = [261.63, 329.63, 392.00, 523.25]; // C major bright
      moodSpeed = 2.0;
      warmth = 0.5;
    } else if (style === 'cozy') {
      chordFreqs = [196.00, 246.94, 293.66, 392.00]; // G major warm
      moodSpeed = 0.8;
      warmth = 0.9;
    } else if (style === 'suspense') {
      chordFreqs = [110.00, 116.54, 164.81, 220.00]; // A minor mystery
      moodSpeed = 0.5;
      warmth = 0.4;
    }

    // 生成優雅柔和的循環和弦與雙耳微相位
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      let sampleL = 0;
      let sampleR = 0;

      for (let c = 0; c < chordFreqs.length; c++) {
        const freq = chordFreqs[c];
        const lfo = 0.5 + 0.5 * Math.sin(2 * Math.PI * (0.15 + c * 0.05) * t * moodSpeed);
        const wave = Math.sin(2 * Math.PI * freq * t) * 0.12 * lfo;
        const sub = Math.sin(Math.PI * freq * t) * 0.05 * (1 - warmth * 0.3);

        sampleL += wave + sub;
        sampleR += Math.sin(2 * Math.PI * freq * t + (c * 0.3)) * 0.12 * lfo + sub;
      }

      // 淡入與淡出 (首尾 1 秒防爆音)
      let envelope = 1.0;
      if (t < 1.0) envelope = t;
      else if (t > totalSeconds - 1.0) envelope = Math.max(0, totalSeconds - t);

      left[i] = sampleL * envelope * 0.25;
      right[i] = sampleR * envelope * 0.25;
    }

    return audioBuffer;
  }

  // ==================== 語音合成引擎 ====================
  /**
   * 瀏覽器原生 Web Speech API 語音合成
   * @param {Object} options
   * @param {string} options.text
   * @param {string} [options.lang='zh-TW']
   * @param {number} [options.rate=1.0]
   * @param {number} [options.pitch=1.0]
   * @returns {Promise<void>}
   */
  function speakWebSpeech({ text, lang = 'zh-TW', rate = 1.0, pitch = 1.0 }) {
    return new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || !window.speechSynthesis) {
        return reject(new Error("此瀏覽器環境不支援 Web Speech API"));
      }

      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.rate = rate;
      utterance.pitch = pitch;

      // 智慧選取最佳中文語音
      const voices = window.speechSynthesis.getVoices();
      const zhVoice = voices.find(v => v.lang.includes('zh') || v.lang.includes('cmn'));
      if (zhVoice) utterance.voice = zhVoice;

      utterance.onend = () => resolve();
      utterance.onerror = (e) => reject(new Error(`語音播放中斷: ${e.error}`));

      window.speechSynthesis.speak(utterance);
    });
  }

  /**
   * 調用 Google Gemini API 產生自然口吻音訊 (PCM / MP3)
   * @param {Object} options
   * @param {string} options.apiKey
   * @param {string} options.text
   * @param {string} [options.voice='Puck'] - Aoede, Puck, Charon, Kore, Fenrir
   * @returns {Promise<string>} Base64 音訊 Data URL
   */
  async function synthesizeSpeechGemini({ apiKey, text, voice = 'Puck' }) {
    if (!apiKey) throw new Error("缺少 Google Gemini API Key");
    if (!text) throw new Error("缺少合成台詞");

    // 使用 Gemini 2.5 Flash / 2.0 原生 Audio 模式
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const payload = {
      contents: [{
        parts: [{
          text: `Please speak the following dialogue with natural emotion and lively theatrical rhythm in authentic Mandarin Chinese without any extra commentary. Dialogue: "${text}"`
        }]
      }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: voice
            }
          }
        }
      }
    };

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Gemini 語音生成失敗 (${res.status})`);
    }

    const data = await res.json();
    const part = data.candidates?.[0]?.content?.parts?.[0];
    const inlineData = part?.inlineData;

    if (!inlineData || !inlineData.data) {
      throw new Error("Gemini 未回傳有效語音二進位串流");
    }

    const mimeType = inlineData.mimeType || "audio/mp3";
    return `data:${mimeType};base64,${inlineData.data}`;
  }

  return {
    SEGMENT_DURATION,
    extractDialogueInfo,
    formatTimecodeSrt,
    formatTimecodeVtt,
    generateSrt,
    generateVtt,
    calculateDuckingRanges,
    generateProceduralBgmBuffer,
    speakWebSpeech,
    synthesizeSpeechGemini,
  };
});
