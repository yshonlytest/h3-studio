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

  return {
    SEGMENT_DURATION_SECONDS,
    getSegmentTimeRange,
    calculateTotalSeconds,
    calculateSegmentCountFromSeconds,
    formatSegmentTitle,
    calculateDefaultEndPanel,
    validateSegments
  };
});
