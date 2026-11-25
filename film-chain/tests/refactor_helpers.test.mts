import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatDiagnosticError } from "../client/utils/errors.ts";
import { computeSegmentTimeRanges } from "../client/features/sessionColab.ts";
import { dispatchPlanByProvider } from "../client/features/director.ts";

describe("A4-4 Refactored Helpers - Diagnostics, Colab Timing, and Plan Dispatch", () => {
  it("formatDiagnosticError formats structured provider errors and falls back cleanly", () => {
    const structured = formatDiagnosticError(new Error("timeout"), "gemini", {
      diagnoseNetworkError: (_err, ctx) => ({
        title: `服務 (${ctx?.service}) 連線逾時`,
        reason: "閘道未回應",
        action: "請檢查 API Key 或 Proxy",
      }),
    });
    assert.equal(structured.title, "服務 (gemini) 連線逾時");
    assert.equal(structured.reason, "閘道未回應");
    assert.equal(structured.action, "請檢查 API Key 或 Proxy");
    assert.equal(structured.plainText, "服務 (gemini) 連線逾時：閘道未回應（請檢查 API Key 或 Proxy）");

    const fallback = formatDiagnosticError(new Error("raw failure"), "openai");
    assert.equal(fallback.title, "");
    assert.equal(fallback.reason, "raw failure");
    assert.equal(fallback.plainText, "raw failure");
  });

  it("computeSegmentTimeRanges handles empty, default 5s, and title timecode ranges", () => {
    const empty = computeSegmentTimeRanges([], false);
    assert.equal(empty.totalSec, 0);
    assert.deepEqual(empty.ranges, []);

    const creative = computeSegmentTimeRanges(
      [{ title: "Part 1 (0-3.5s)" }, { title: "Part 2" }],
      false
    );
    assert.equal(creative.ranges.length, 2);
    assert.deepEqual(creative.ranges[0], { startS: 0, endS: 3.5, durationSec: 3.5 });
    assert.deepEqual(creative.ranges[1], { startS: 3.5, endS: 8.5, durationSec: 5 });
    assert.equal(creative.totalSec, 9);
  });

  it("dispatchPlanByProvider rejects missing Gemini and OpenAI keys clearly", async () => {
    const emptyPrefs = {
      geminiKey: "",
      openaiKey: "",
      openaiBaseUrl: "https://api.openai.com/v1",
      openaiModel: "gpt-4o",
      falKey: "",
      minimaxKey: "",
      cloudVideoKey: "",
      cloudVideoBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      cloudVideoModel: "doubao",
      comfyUrl: "http://127.0.0.1:8188",
      promptProvider: "gemini",
      imageProvider: "agent-image",
    };

    const g = globalThis as Record<string, unknown>;
    const hadDoc = Object.prototype.hasOwnProperty.call(g, "document");
    const prevDoc = g.document;
    const prevStorageDesc = Object.getOwnPropertyDescriptor(g, "localStorage");
    g.document = {
      getElementById: () => ({ value: "", showModal: () => {} }),
    };
    Object.defineProperty(g, "localStorage", {
      configurable: true,
      writable: true,
      value: { getItem: () => null, setItem: () => {} },
    });

    try {
      await assert.rejects(
        () =>
          dispatchPlanByProvider({
            promptProvider: "gemini",
            desc: "測試",
            durationMode: "auto",
            targetSec: 15,
            sysPrompt: "sys",
            prefs: emptyPrefs,
          }),
        /Google Gemini API Key/
      );

      await assert.rejects(
        () =>
          dispatchPlanByProvider({
            promptProvider: "openai",
            desc: "測試",
            durationMode: "auto",
            targetSec: 15,
            sysPrompt: "sys",
            prefs: emptyPrefs,
          }),
        /OpenAI API Key/
      );
    } finally {
      if (hadDoc) {
        g.document = prevDoc;
      } else {
        delete g.document;
      }
      if (prevStorageDesc) {
        Object.defineProperty(g, "localStorage", prevStorageDesc);
      } else {
        delete g.localStorage;
      }
    }
  });
});
