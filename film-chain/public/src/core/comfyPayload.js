/**
 * H3 Storyboard Studio - comfyPayload.js
 * 純邏輯：ComfyUI /prompt 呼叫圖 (Graph JSON) 組裝與驗證
 */
(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    root.H3ComfyPayload = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_BASE_CONFIG = {
    width: 640,
    height: 480,
    frames: 81,
    seed: 42,
    ssd_streaming: true
  };

  const DEFAULT_SPEED_CONFIG = {
    steps: 16,
    layers: "45",
    reuse: 2,
    core_reuse: 0,
    token_reduction: false,
    render_width: 0,
    render_height: 0
  };

  /**
   * 組裝 ComfyUI API Prompt 工作流物件
   * @param {string} uploadedGridFilename - 已上傳至 ComfyUI input 資料夾之九宮格圖檔名
   * @param {Array} segments - 分鏡段落陣列 [{ title, end_panel, prompt }]
   * @param {Object} [speedConfig] - 速度/畫質設定
   * @param {string} [outputPrefix] - 輸出影片前綴 (例: "okinawa_shisa/shisa_15s_story")
   * @param {Object} [baseConfig] - 基礎畫質設定 (寬度、高度、影格數、隨機種子等)
   * @returns {Object} 符合 ComfyUI /prompt API 格式的 Graph JSON 物件
   */
  function buildComfyApiPrompt(uploadedGridFilename, segments, speedConfig, outputPrefix, baseConfig) {
    if (!uploadedGridFilename || typeof uploadedGridFilename !== 'string') {
      throw new Error("必須提供有效的九宮格圖檔名稱 (uploadedGridFilename)");
    }
    if (!Array.isArray(segments) || segments.length === 0) {
      throw new Error("分段列表 (segments) 必須為非空陣列");
    }

    // 防禦性檢查：驗證各分段至少具備標題、有效 end_panel 與提示詞
    segments.forEach((seg, i) => {
      if (!seg || typeof seg !== 'object') {
        throw new Error(`分段列表第 ${i + 1} 項不是有效的物件`);
      }
      const panel = Number(seg.end_panel);
      if (isNaN(panel) || panel < 1 || panel > 9) {
        throw new Error(`分段列表第 ${i + 1} 項之 end_panel 必須為 1 到 9 之間的整數，當前為: ${seg.end_panel}`);
      }
      if (!seg.prompt || typeof seg.prompt !== 'string' || !seg.prompt.trim()) {
        throw new Error(`分段列表第 ${i + 1} 項缺少有效的提示詞 (prompt)`);
      }
    });

    const rawSpeed = Object.assign({}, DEFAULT_SPEED_CONFIG, speedConfig || {});
    const rawBase = Object.assign({}, DEFAULT_BASE_CONFIG, baseConfig || {});

    // 數值邊界防呆與正規化（嚴格對齊 H3ChainedStoryboardVideo INPUT_TYPES）
    const validLayers = ["40", "45", "50"];
    const layerStr = String(rawSpeed.layers || DEFAULT_SPEED_CONFIG.layers);
    const rw = Math.max(0, Math.round(Number(rawSpeed.render_width) || 0));
    const rh = Math.max(0, Math.round(Number(rawSpeed.render_height) || 0));
    const speed = {
      steps: Math.max(2, Math.round(Number(rawSpeed.steps) || DEFAULT_SPEED_CONFIG.steps)),
      layers: validLayers.includes(layerStr) ? layerStr : "45",
      reuse: Math.min(3, Math.max(1, Math.round(Number(rawSpeed.reuse) || DEFAULT_SPEED_CONFIG.reuse))),
      core_reuse: Math.min(6, Math.max(0, Math.round(Number(rawSpeed.core_reuse) || 0))),
      token_reduction: Boolean(rawSpeed.token_reduction),
      render_width: rw >= 32 ? rw : 0,
      render_height: rh >= 32 ? rh : 0
    };

    const base = {
      width: Math.max(64, Math.round(Number(rawBase.width) || DEFAULT_BASE_CONFIG.width)),
      height: Math.max(64, Math.round(Number(rawBase.height) || DEFAULT_BASE_CONFIG.height)),
      frames: Math.max(1, Math.round(Number(rawBase.frames) || DEFAULT_BASE_CONFIG.frames)),
      seed: Number.isFinite(Number(rawBase.seed)) ? Number(rawBase.seed) : DEFAULT_BASE_CONFIG.seed,
      ssd_streaming: Boolean(rawBase.ssd_streaming)
    };

    const prefix = outputPrefix || `storyboard/story_${Date.now()}`;

    return {
      "3": {
        "class_type": "LoadImage",
        "inputs": {
          "image": uploadedGridFilename
        },
        "_meta": {
          "title": "Load 3x3 Storyboard Grid"
        }
      },
      "1": {
        "class_type": "H3ChainedStoryboardVideo",
        "inputs": {
          "storyboard_grid": ["3", 0],
          "segments_json": JSON.stringify(segments, null, 2),
          "width": base.width,
          "height": base.height,
          "frames": base.frames,
          "steps": speed.steps,
          "layers": speed.layers,
          "reuse": speed.reuse,
          "core_reuse": speed.core_reuse,
          "token_reduction": speed.token_reduction,
          "render_width": speed.render_width,
          "render_height": speed.render_height,
          "seed": base.seed,
          "ssd_streaming": Boolean(base.ssd_streaming),
          "chain_mode": (speedConfig && speedConfig.chain_mode) || "motion_context"
        },
        "_meta": {
          "title": "H3 Chained Storyboard Video"
        }
      },
      "2": {
        "class_type": "SaveVideo",
        "inputs": {
          "filename_prefix": prefix,
          "format": "mp4",
          "format.codec": "auto",
          "codec": "auto",
          "video": ["1", 0]
        },
        "_meta": {
          "title": "Save Final Merged Video"
        }
      }
    };
  }

  return {
    DEFAULT_BASE_CONFIG,
    DEFAULT_SPEED_CONFIG,
    buildComfyApiPrompt
  };
});
