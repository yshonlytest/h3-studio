/**
 * H3 Storyboard Studio - timecodeHelper.js
 * 純邏輯：時間軸運算、分段時長計算、分鏡格錨定推算
 */
(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    root.H3TimecodeHelper = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SEGMENT_DURATION_SECONDS = 5;

  /**
   * 取得指定分段索引 (0-based) 的時間區間 (秒數)
   * @param {number} segmentIndex - 0, 1, 2...
   * @returns {{ startSec: number, endSec: number, duration: number }}
   */
  function getSegmentTimeRange(segmentIndex) {
    const rawIdx = Number(segmentIndex);
    const idx = Math.max(0, Math.floor(isNaN(rawIdx) ? 0 : rawIdx));
    const startSec = idx * SEGMENT_DURATION_SECONDS;
    const endSec = (idx + 1) * SEGMENT_DURATION_SECONDS;
    return {
      startSec,
      endSec,
      duration: SEGMENT_DURATION_SECONDS
    };
  }

  /**
   * 依總段數計算總長度 (秒)
   * @param {number} segmentCount - 段落數
   * @returns {number} 總秒數 (5 的倍數)
   */
  function calculateTotalSeconds(segmentCount) {
    const rawCount = Number(segmentCount);
    const count = Math.max(1, Math.floor(isNaN(rawCount) ? 1 : rawCount || 1));
    return count * SEGMENT_DURATION_SECONDS;
  }

  /**
   * 依期望總秒數反推所需段數 (無條件進位至 5 的倍數)
   * @param {number} targetSeconds - 期望總秒數 (例如 15)
   * @returns {number} 段數 (例如 3)
   */
  function calculateSegmentCountFromSeconds(targetSeconds) {
    const rawSec = Number(targetSeconds);
    const sec = Math.max(5, Math.round(isNaN(rawSec) ? 5 : rawSec || 5));
    return Math.max(1, Math.ceil(sec / SEGMENT_DURATION_SECONDS));
  }

  /**
   * 格式化分段標題
   * @param {number} segmentIndex - 0-based
   * @param {string} [customSummary] - 自訂或 AI 規劃的中文劇情簡述
   * @returns {string} 格式化標題 (例如: "Part 1 (0-5s): 甦醒伸展肩膀")
   */
  function formatSegmentTitle(segmentIndex, customSummary) {
    const { startSec, endSec } = getSegmentTimeRange(segmentIndex);
    const partNum = segmentIndex + 1;
    const summary = customSummary ? customSummary.trim() : `第 ${partNum} 幕分鏡`;
    // 若傳入的文字已包含 "Part X" 則直接回傳避免重複拼接
    if (/^Part\s+\d+/i.test(summary)) {
      return summary;
    }
    return `Part ${partNum} (${startSec}-${endSec}s): ${summary}`;
  }

  /**
   * 依分段索引與總段數推算預設目標尾幀 Panel 編號 (1~9)
   * 確保尾幀均勻分布且隨時間單調遞增，最後一段必然錨定至 Panel 9
   * @param {number} segmentIndex - 0-based
   * @param {number} totalSegments - 總段數
   * @returns {number} Panel 編號 (1~9)
   */
  function calculateDefaultEndPanel(segmentIndex, totalSegments) {
    const total = Math.max(1, totalSegments || 1);
    const idx = Math.max(0, Math.min(segmentIndex, total - 1));
    if (idx === total - 1) return 9; // 最後一段固定為 9
    // 等比例分佈於 1..9
    const step = 8 / total;
    const panel = Math.round(1 + (idx + 1) * step);
    return Math.max(1, Math.min(9, panel));
  }

  /**
   * 驗證分段資料的結構完整性
   * @param {Array} segments - 分段陣列
   * @returns {{ valid: boolean, errors: string[] }}
   */
  function validateSegments(segments) {
    const errors = [];
    if (!Array.isArray(segments) || segments.length === 0) {
      errors.push("分段列表必須為非空陣列");
      return { valid: false, errors };
    }

    let prevPanel = 0;
    segments.forEach((seg, i) => {
      if (!seg || typeof seg !== 'object') {
        errors.push(`第 ${i + 1} 段不是有效的物件`);
        return;
      }
      if (!seg.title || typeof seg.title !== 'string') {
        errors.push(`第 ${i + 1} 段缺少有效標題 (title)`);
      }
      const panel = Number(seg.end_panel);
      if (isNaN(panel) || panel < 1 || panel > 9) {
        errors.push(`第 ${i + 1} 段之 end_panel 必須為 1 到 9 之間的整數，當前為: ${seg.end_panel}`);
      } else {
        if (panel < prevPanel) {
          errors.push(`第 ${i + 1} 段之 end_panel (${panel}) 小於前一段 (${prevPanel})，必須維持單調非遞減`);
        }
        prevPanel = panel;
      }
      if (!seg.prompt || typeof seg.prompt !== 'string' || !seg.prompt.trim()) {
        errors.push(`第 ${i + 1} 段缺少提示詞 (prompt)`);
      }
    });

    const lastSeg = segments[segments.length - 1];
    if (lastSeg && Number(lastSeg.end_panel) !== 9) {
      errors.push(`最終分段之 end_panel 必須錨定為 9，當前為: ${lastSeg.end_panel}`);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * 計算單一分鏡段落的秒數與時間區間 (相容 Creative 固定秒數與 Edu 動態幀數 / 浮點時間標籤)
   * @param {Object} seg - 分鏡物件
   * @param {number} runningSec - 累計起始秒數
   * @param {boolean} isEdu - 是否為教學長片模式
   * @returns {{ startSec: number, endSec: number, durationSec: number }}
   */
  function resolveSegmentTiming(seg, runningSec, isEdu) {
    const startS = Math.round((Number(runningSec) || 0) * 10) / 10;
    if (seg && typeof seg === 'object') {
      if (isEdu && Number(seg.frames) > 0) {
        const dur = Math.floor((Number(seg.frames) / 24) * 10) / 10;
        const endS = Math.round((startS + dur) * 10) / 10;
        return { startSec: startS, endSec: endS, durationSec: dur };
      }
      const timeMatch = String(seg.title || '').match(/\((\d+(?:\.\d+)?)[-~](\d+(?:\.\d+)?)s\)/);
      if (timeMatch) {
        const s = parseFloat(timeMatch[1]);
        const e = parseFloat(timeMatch[2]);
        if (!isNaN(s) && !isNaN(e) && e > s) {
          const dur = Math.round((e - s) * 10) / 10;
          return { startSec: s, endSec: e, durationSec: dur };
        }
      }
      if (Number(seg.frames) > 0 && Number(seg.frames) !== 124) {
        const dur = Math.floor((Number(seg.frames) / 24) * 10) / 10;
        const endS = Math.round((startS + dur) * 10) / 10;
        return { startSec: startS, endSec: endS, durationSec: dur };
      }
    }
    const endS = Math.round((startS + SEGMENT_DURATION_SECONDS) * 10) / 10;
    return { startSec: startS, endSec: endS, durationSec: SEGMENT_DURATION_SECONDS };
  }

  /**
   * 建構 Colab 分鏡任務檔名，避免 project_slug 已結尾為 _\d+s 時重複拼接秒數
   * @param {string} slug - 專案代稱
   * @param {number} totalSeconds - 總秒數
   * @returns {string} 例如 "colab_manifest_h3_studio_tutorial_105s.json" 或 "colab_manifest_detective_25s.json"
   */
  function buildColabManifestFilename(slug, totalSeconds) {
    const cleanSlug = String(slug || 'story_project').trim() || 'story_project';
    const roundedSec = Math.max(5, Math.round(Number(totalSeconds) || 5));
    const baseSlug = cleanSlug.replace(/_\d+(?:\.\d+)?s$/i, '');
    return `colab_manifest_${baseSlug}_${roundedSec}s.json`;
  }

  const HANDOFF_SCHEMA_VERSION = 'h3.storyboard_handoff.v2';
  const INLINE_PAYLOAD_MAX_SEGMENTS = 6;
  const INLINE_PAYLOAD_MAX_BYTES = 12000;

  /**
   * 依分鏡段落內容計算穩定版次雜湊，避免 Agent 誤跑舊版分鏡
   * @param {Array} segments
   * @param {string} projectSlug
   * @returns {string}
   */
  function computeStoryboardRevision(segments, projectSlug) {
    const segs = Array.isArray(segments) ? segments : [];
    const slug = String(projectSlug || 'story_project').trim();
    let hash = 2166136261;
    const feed = (str) => {
      const s = String(str || '');
      for (let i = 0; i < s.length; i++) {
        hash ^= s.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
    };
    feed(`${slug}:${segs.length}`);
    segs.forEach((seg, idx) => {
      if (!seg || typeof seg !== 'object') return;
      feed(`|${idx + 1}:${seg.title || ''}:${seg.frames || 124}:${seg.shot_type || ''}:${seg.chain_mode || ''}:${seg.end_panel || 9}:${seg.dialogue || seg.display_dialogue || ''}:${seg.spoken_dialogue || ''}:${seg.prompt || ''}`);
    });
    return 'rev_' + (hash >>> 0).toString(16).padStart(8, '0');
  }

  /**
   * 建立分鏡交接中繼資料與配送策略 (小型分鏡內嵌 / 大型分鏡匯出檔)
   * @param {{ projectSlug?: string, sessionId?: string, segments?: Array, totalSeconds?: number }} ctx
   */
  function buildHandoffMetadata(ctx) {
    const c = ctx || {};
    const segs = Array.isArray(c.segments) ? c.segments : [];
    const slug = String(c.projectSlug || 'story_project').trim() || 'story_project';
    const roundedSec = Math.max(5, Math.round(Number(c.totalSeconds) || 5));
    const revision = computeStoryboardRevision(segs, slug);
    const approxBytes = JSON.stringify(segs).length;
    const useInline = segs.length > 0 && segs.length <= INLINE_PAYLOAD_MAX_SEGMENTS && approxBytes <= INLINE_PAYLOAD_MAX_BYTES;
    return {
      schema_version: HANDOFF_SCHEMA_VERSION,
      session_id: String(c.sessionId || ''),
      revision,
      segment_count: segs.length,
      total_seconds: roundedSec,
      delivery_mode: useInline ? 'inline_payload' : 'manifest_file'
    };
  }

  /**
   * 當交接模式為 inline_payload 時，輸出精簡版 <H3_STORYBOARD_PAYLOAD> 區塊並清理 data URI
   * @param {Object} manifest
   * @returns {string}
   */
  function formatInlinePayloadBlock(manifest) {
    if (!manifest || typeof manifest !== 'object' || manifest.delivery_mode !== 'inline_payload') {
      return '';
    }
    const sanitizeRef = (val) => (typeof val === 'string' && val.startsWith('data:') ? 'reference_character.png' : val);
    const cleanSegments = Array.isArray(manifest.segments)
      ? manifest.segments.map((s) => ({
          ...s,
          first_frame: sanitizeRef(s.first_frame)
        }))
      : [];
    const payload = {
      schema_version: manifest.schema_version || HANDOFF_SCHEMA_VERSION,
      project: manifest.project || 'story_project',
      title: manifest.title || manifest.project || 'story_project',
      session_id: manifest.session_id || '',
      revision: manifest.revision || computeStoryboardRevision(cleanSegments, manifest.project),
      total_seconds: manifest.total_seconds || 5,
      segment_count: cleanSegments.length,
      execution_track: manifest.execution_track,
      anchor_ref_image: sanitizeRef(manifest.anchor_ref_image),
      global_profile: manifest.global_profile,
      segments: cleanSegments
    };
    Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);
    return `\n\n<H3_STORYBOARD_PAYLOAD>\n${JSON.stringify(payload)}\n</H3_STORYBOARD_PAYLOAD>`;
  }

  return {
    SEGMENT_DURATION_SECONDS,
    HANDOFF_SCHEMA_VERSION,
    INLINE_PAYLOAD_MAX_SEGMENTS,
    INLINE_PAYLOAD_MAX_BYTES,
    getSegmentTimeRange,
    calculateTotalSeconds,
    calculateSegmentCountFromSeconds,
    formatSegmentTitle,
    calculateDefaultEndPanel,
    validateSegments,
    resolveSegmentTiming,
    buildColabManifestFilename,
    computeStoryboardRevision,
    buildHandoffMetadata,
    formatInlinePayloadBlock
  };
});
