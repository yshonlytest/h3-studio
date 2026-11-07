const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const timecodeHelper = require('../public/src/core/timecodeHelper.js');
const promptBuilder = require('../public/src/core/promptBuilder.js');
const comfyPayload = require('../public/src/core/comfyPayload.js');
const cloudDiagnostics = require('../public/src/core/cloudDiagnostics.js');

describe('H3 Storyboard Studio - Core Modules Unit Tests', () => {

  // ==================== 1. timecodeHelper ====================
  describe('timecodeHelper', () => {
    it('should correctly calculate segment time ranges', () => {
      assert.deepEqual(timecodeHelper.getSegmentTimeRange(0), { startSec: 0, endSec: 5, duration: 5 });
      assert.deepEqual(timecodeHelper.getSegmentTimeRange(1), { startSec: 5, endSec: 10, duration: 5 });
      assert.deepEqual(timecodeHelper.getSegmentTimeRange(2), { startSec: 10, endSec: 15, duration: 5 });
      assert.deepEqual(timecodeHelper.getSegmentTimeRange(3), { startSec: 15, endSec: 20, duration: 5 });
    });

    it('should correctly calculate total seconds and segment counts', () => {
      assert.equal(timecodeHelper.calculateTotalSeconds(3), 15);
      assert.equal(timecodeHelper.calculateTotalSeconds(4), 20);
      assert.equal(timecodeHelper.calculateSegmentCountFromSeconds(15), 3);
      assert.equal(timecodeHelper.calculateSegmentCountFromSeconds(20), 4);
      assert.equal(timecodeHelper.calculateSegmentCountFromSeconds(5), 1);
      // 無條件進位驗證：11s 與 12s 必須進位為 3 段 (15s)
      assert.equal(timecodeHelper.calculateSegmentCountFromSeconds(11), 3);
      assert.equal(timecodeHelper.calculateSegmentCountFromSeconds(12), 3);
      assert.deepEqual(timecodeHelper.getSegmentTimeRange("2"), { startSec: 10, endSec: 15, duration: 5 });
    });

    it('should format segment titles with Part prefix and timecodes', () => {
      const title1 = timecodeHelper.formatSegmentTitle(0, "甦醒伸展肩膀");
      assert.equal(title1, "Part 1 (0-5s): 甦醒伸展肩膀");

      // Preserves existing Part title without duplicate prefix
      const title2 = timecodeHelper.formatSegmentTitle(1, "Part 2 (5-10s): 雜耍沖繩苦瓜");
      assert.equal(title2, "Part 2 (5-10s): 雜耍沖繩苦瓜");
    });

    it('should calculate monotonically increasing default end panels and pin final to 9', () => {
      // 3 segments: 0 -> panel 4, 1 -> panel 6, 2 -> panel 9
      const p0 = timecodeHelper.calculateDefaultEndPanel(0, 3);
      const p1 = timecodeHelper.calculateDefaultEndPanel(1, 3);
      const p2 = timecodeHelper.calculateDefaultEndPanel(2, 3);

      assert.ok(p0 >= 1 && p0 <= 9);
      assert.ok(p1 >= p0 && p1 <= 9);
      assert.equal(p2, 9, "Final segment end_panel must be pinned to 9");
    });

    it('should validate segment structures and catch invalid fields', () => {
      const valid = [
        { title: "Part 1 (0-5s)", end_panel: 3, prompt: "Valid prompt" },
        { title: "Part 2 (5-10s)", end_panel: 9, prompt: "Another valid prompt" }
      ];
      assert.equal(timecodeHelper.validateSegments(valid).valid, true);

      const invalid = [
        { title: "", end_panel: 12, prompt: "" }
      ];
      const res = timecodeHelper.validateSegments(invalid);
      assert.equal(res.valid, false);
      assert.ok(res.errors.length >= 2);

      // 檢查非單調遞增與最後一段非 9 的規格約束
      const nonMonotonic = [
        { title: "Part 1 (0-5s)", end_panel: 7, prompt: "Prompt 1" },
        { title: "Part 2 (5-10s)", end_panel: 4, prompt: "Prompt 2" }
      ];
      const resMonotonic = timecodeHelper.validateSegments(nonMonotonic);
      assert.equal(resMonotonic.valid, false);
      assert.ok(resMonotonic.errors.some(e => e.includes("必須維持單調非遞減")));
      assert.ok(resMonotonic.errors.some(e => e.includes("必須錨定為 9")));
    });
  });

  // ==================== 2. promptBuilder ====================
  describe('promptBuilder', () => {
    it('should build director system prompt with expand mode requirements', () => {
      const prompt = promptBuilder.buildDirectorSystemPrompt('expand', 20);
      assert.ok(prompt.includes("total video duration of 20 seconds"));
      assert.ok(prompt.includes("4 sequential 5-second segments"));
      assert.ok(prompt.includes("3x3 nine-panel photo grid"));
      assert.ok(prompt.includes(promptBuilder.CONTINUITY_PHRASE));
      assert.ok(prompt.includes("[Scene]"));
      assert.ok(prompt.includes("motion_context"));
    });

    it('should parse 5D Context-IR fields from structured prompt', () => {
      const raw = "[Scene] Rain-slicked Neo-Tokyo alley. [Camera] Low-angle dolly-in shot. Timeline: 0-2.5s: Detective walks forward. 2.5-5.0s: Speaks <d>[Chinese] 你好</d>. [Look] Neon noir reflections. Audio: Heavy rain and <d>[Chinese] 你好</d>.";
      const parsed = promptBuilder.parseContextIRFromPrompt(raw);
      assert.equal(parsed.scene, "Rain-slicked Neo-Tokyo alley");
      assert.equal(parsed.camera, "Low-angle dolly-in shot");
      assert.ok(parsed.action.includes("0-2.5s: Detective walks forward"));
      assert.equal(parsed.look, "Neon noir reflections");
      assert.ok(parsed.audio.includes("Heavy rain"));
    });

    it('should build director system prompt with auto mode adaptive duration instructions', () => {
      const prompt = promptBuilder.buildDirectorSystemPrompt('auto');
      assert.ok(prompt.includes("freely determine the optimal total duration in seconds"));
      assert.ok(prompt.includes("must be a multiple of 5"));
      assert.ok(prompt.includes("3x3 nine-panel photo grid"));
      assert.ok(prompt.includes(promptBuilder.CONTINUITY_PHRASE));
    });

    it('should ensure continuity prefix is applied to segments 2..N', () => {
      const seg0 = "Cinematic opening scene establishing character.";
      const seg1Raw = "Subject continues juggling and looks to camera.";

      // Segment 0 does not enforce continuity prefix
      assert.equal(promptBuilder.ensureContinuityPrefix(0, seg0), seg0);

      // Segment 1 enforces continuity prefix
      const seg1Guaranteed = promptBuilder.ensureContinuityPrefix(1, seg1Raw);
      assert.ok(seg1Guaranteed.startsWith(promptBuilder.CONTINUITY_PHRASE));

      // Does not duplicate prefix if already present
      const seg1AlreadyGood = `${promptBuilder.CONTINUITY_PHRASE}, smooth movement forward.`;
      assert.equal(promptBuilder.ensureContinuityPrefix(1, seg1AlreadyGood), seg1AlreadyGood);
    });

    it('should wrap and extract Chinese dialogue tags', () => {
      const wrapped = promptBuilder.wrapDialogueTag("坐太久活動一下");
      assert.equal(wrapped, "<d>[Chinese] 坐太久活動一下</d>");

      const promptText = `Timeline: 2.0-5.0s Shisa smiles and speaks: ${wrapped}. Audio: authentic speech: ${wrapped}.`;
      const extracted = promptBuilder.extractDialogueTags(promptText);
      assert.deepEqual(extracted, ["坐太久活動一下", "坐太久活動一下"]);
    });

    it('should clean markdown backticks and parse JSON safely', () => {
      const raw = "```json\n{\n  \"project_slug\": \"test_slug\",\n  \"recommended_total_seconds\": 15\n}\n```";
      const parsed = promptBuilder.cleanAndParseJson(raw);
      assert.equal(parsed.project_slug, "test_slug");
      assert.equal(parsed.recommended_total_seconds, 15);

      // 支援 LLM 包含思考引言與雜訊前綴的情境
      const conversational = "Here is the film director plan you requested:\n```json\n{\n  \"project_slug\": \"okinawa_shisa\",\n  \"recommended_total_seconds\": 20\n}\n```\nHope this helps!";
      const parsedConv = promptBuilder.cleanAndParseJson(conversational);
      assert.equal(parsedConv.project_slug, "okinawa_shisa");
      assert.equal(parsedConv.recommended_total_seconds, 20);

      // 支援純文字無代碼框但外圍有前後文的情境（包含可能干擾匹配的中括號）
      const plain = "Analysis result [Plan v1.0]: {\"project_slug\": \"plain_slug\", \"recommended_total_seconds\": 10} completed.";
      const parsedPlain = promptBuilder.cleanAndParseJson(plain);
      assert.equal(parsedPlain.project_slug, "plain_slug");
      assert.equal(parsedPlain.recommended_total_seconds, 10);
    });
  });

  // ==================== 3. comfyPayload ====================
  describe('comfyPayload', () => {
    it('should build a valid ComfyUI prompt API graph structure', () => {
      const segments = [
        { title: "Part 1 (0-5s)", end_panel: 3, prompt: "P1" },
        { title: "Part 2 (5-10s)", end_panel: 9, prompt: "P2" }
      ];
      const payload = comfyPayload.buildComfyApiPrompt("test_grid.png", segments, { steps: 8, layers: "45" }, "test/output");

      assert.ok(payload["3"], "Must contain LoadImage node 3");
      assert.equal(payload["3"].class_type, "LoadImage");
      assert.equal(payload["3"].inputs.image, "test_grid.png");

      assert.ok(payload["1"], "Must contain H3ChainedStoryboardVideo node 1");
      assert.equal(payload["1"].class_type, "H3ChainedStoryboardVideo");
      assert.equal(payload["1"].inputs.steps, 8);
      assert.equal(payload["1"].inputs.layers, "45");
      assert.equal(payload["1"].inputs.ssd_streaming, true);
      assert.deepEqual(payload["1"].inputs.storyboard_grid, ["3", 0]);

      assert.ok(payload["2"], "Must contain SaveVideo node 2");
      assert.equal(payload["2"].class_type, "SaveVideo");
      assert.equal(payload["2"].inputs.filename_prefix, "test/output");
      assert.deepEqual(payload["2"].inputs.video, ["1", 0]);
    });

    it('should throw error if filename is missing or segments are empty', () => {
      assert.throws(() => {
        comfyPayload.buildComfyApiPrompt("", [{ title: "P1", end_panel: 1, prompt: "A" }]);
      }, /uploadedGridFilename/);

      assert.throws(() => {
        comfyPayload.buildComfyApiPrompt("grid.png", []);
      }, /segments/);

      // 段落缺少 prompt 時應主動攔截
      assert.throws(() => {
        comfyPayload.buildComfyApiPrompt("grid.png", [{ title: "P1", end_panel: 1, prompt: "" }]);
      }, /缺少有效的提示詞/);

      // 段落缺少或提供無效 end_panel 時應主動攔截
      assert.throws(() => {
        comfyPayload.buildComfyApiPrompt("grid.png", [{ title: "P1", end_panel: 15, prompt: "Valid" }]);
      }, /end_panel 必須為 1 到 9 之間的整數/);
      assert.throws(() => {
        comfyPayload.buildComfyApiPrompt("grid.png", [{ title: "P1", prompt: "Valid" }]);
      }, /end_panel 必須為 1 到 9 之間的整數/);
    });

    it('should sanitize and normalize negative or malformed speed options', () => {
      const payload = comfyPayload.buildComfyApiPrompt("grid.png", [{ title: "P1", end_panel: 1, prompt: "A" }], {
        steps: -10,
        layers: "invalid",
        token_reduction: true
      });
      assert.ok(payload["1"].inputs.steps >= 2, "Steps must be at least 2");
      assert.equal(payload["1"].inputs.layers, "45", "Invalid layers should fallback to default 45");
      assert.equal(typeof payload["1"].inputs.token_reduction, "boolean", "Token reduction must be boolean");
    });
  });

  // ==================== 4. cloudDiagnostics ====================
  describe('cloudDiagnostics', () => {
    it('should detect ComfyUI connection failure and provide action guide', () => {
      const diag = cloudDiagnostics.diagnoseNetworkError(new Error("Failed to fetch"), { url: "http://127.0.0.1:8188/prompt" });
      assert.equal(diag.isComfy, true);
      assert.equal(diag.isCors, true);
      assert.ok(diag.action.includes("一鍵啟動_H3分鏡工作坊.command"));
    });

    it('should detect 401/403 authorization failures', () => {
      const diag = cloudDiagnostics.diagnoseNetworkError(new Error("Unauthorized"), { status: 401 });
      assert.equal(diag.isAuth, true);
      assert.ok(diag.title.includes("API 金鑰"));
    });

    it('should detect 429 rate limit quota errors', () => {
      const diag = cloudDiagnostics.diagnoseNetworkError(new Error("Resource has been exhausted (e.g. check quota)"), { status: 429 });
      assert.ok(diag.title.includes("超出限制"));
    });

    it('should detect HTTP 400 ComfyUI node validation errors properly', () => {
      const diag = cloudDiagnostics.diagnoseNetworkError(new Error("Node validation error: inputs missing"), {
        url: "http://127.0.0.1:8188/prompt",
        status: 400
      });
      assert.equal(diag.isComfy, true);
      assert.ok(diag.title.includes("HTTP 400"));
      assert.ok(diag.action.includes("custom_nodes"));
    });

    it('should detect HTTP 500 / 503 server errors for local and cloud targets', () => {
      const diagLocal = cloudDiagnostics.diagnoseNetworkError(new Error("Internal Server Error"), {
        url: "http://127.0.0.1:8188/prompt",
        status: 500
      });
      assert.equal(diagLocal.isComfy, true);
      assert.ok(diagLocal.title.includes("HTTP 500"));

      const diagCloud = cloudDiagnostics.diagnoseNetworkError(new Error("Bad Gateway"), {
        url: "https://api.seedance.com/v1/video",
        status: 502
      });
      assert.equal(diagCloud.isComfy, false);
      assert.ok(diagCloud.title.includes("HTTP 5xx"));
    });

    it('should detect remote third-party API CORS or network blocking', () => {
      const diag = cloudDiagnostics.diagnoseNetworkError(new TypeError("Failed to fetch"), {
        url: "https://api.minimax.chat/v1/video_generation",
        service: "minimax"
      });
      assert.equal(diag.isCors, true);
      assert.equal(diag.isComfy, false);
      assert.ok(diag.title.includes("跨域 (CORS) 或網路阻擋"));
      assert.ok(diag.action.includes("路線 A"));
    });
    it('should distinguish ComfyUI response/parsing failure from server down/connection failure', () => {
      // 非連線異常（如回應非預期 JSON）不應誤判為「服務未啟動」
      const diagNonConn = cloudDiagnostics.diagnoseNetworkError(new Error("Unexpected token < in JSON at position 0"), {
        url: "http://127.0.0.1:8188/prompt",
        status: 200
      });
      assert.equal(diagNonConn.isComfy, true);
      assert.equal(diagNonConn.isCors, false);
      assert.ok(diagNonConn.title.includes("ComfyUI 執行或回應異常"));
      assert.ok(!diagNonConn.action.includes("一鍵啟動"));
    });
  });

});
