/**
 * DOM Integrity Test for H3 Storyboard Studio
 * Validates that all inline event handlers (onclick, onchange, oninput, etc.)
 * in film-chain/public/index.html have corresponding function definitions
 * either in public/index.html or external scripts.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

describe("H3 Storyboard Studio - DOM Integrity Tests", () => {
  const htmlPath = path.resolve(__dirname, "../public/index.html");
  const htmlContent = fs.readFileSync(htmlPath, "utf-8");

  // Load extracted scripts
  const jsFiles = [
    "../public/src/prompts/agentPrompts.js",
    "../public/src/controllers/studioAudioSubtitles.js",
    "../public/src/core/timecodeHelper.js",
    "../public/src/core/promptBuilder.js",
    "../public/src/core/comfyPayload.js",
    "../public/src/core/cloudDiagnostics.js",
    "../public/src/core/cloudApiAdapter.js",
    "../public/src/core/audioStudio.js",
    "../public/src/core/projectStore.js"
  ];

  let combinedJs = htmlContent;
  for (const rel of jsFiles) {
    const full = path.resolve(__dirname, rel);
    if (fs.existsSync(full)) {
      combinedJs += "\n" + fs.readFileSync(full, "utf-8");
    }
  }

  test("should have function definitions for all inline DOM event handlers", () => {
    // Extract inline handlers like onclick="myFunc(...)"
    const handlerRegex = /on[a-z]+="([^"]+)"/gi;
    const matches = htmlContent.matchAll(handlerRegex);
    const invokedFunctions = new Set();

    const builtins = new Set([
      "if", "for", "while", "switch", "alert", "confirm", "prompt",
      "parseInt", "parseFloat", "Boolean", "Number", "String", "var", "let", "const",
      "click", "close", "showModal", "preventDefault", "stopPropagation",
      "focus", "blur", "select", "reset", "submit", "closest", "removeAttribute",
      "getElementById", "querySelectorAll", "scrollIntoView", "play", "pause",
      "setAttribute", "getAttribute", "contains", "add", "remove", "toggle"
    ]);

    for (const match of matches) {
      const code = match[1];
      const fnMatches = code.matchAll(/([a-zA-Z0-9_$]+)\s*\(/g);
      for (const fnMatch of fnMatches) {
        const fnName = fnMatch[1];
        if (!builtins.has(fnName)) {
          invokedFunctions.add(fnName);
        }
      }
    }

    assert.ok(invokedFunctions.size > 20, `Expected >20 DOM handler functions, found ${invokedFunctions.size}`);

    // Check that each invoked function is declared: function fnName( or window.fnName = or fnName = function
    const missing = [];
    for (const fn of invokedFunctions) {
      const declRegex = new RegExp(
        `(function\\s+${fn}\\b|\\bwindow\\.${fn}\\s*=|\\b${fn}\\s*=\\s*(async\\s+)?function|\\bclass\\s+${fn}\\b|\\bconst\\s+${fn}\\s*=|\\blet\\s+${fn}\\s*=|\\bvar\\s+${fn}\\s*=)`
      );
      if (!declRegex.test(combinedJs)) {
        missing.push(fn);
      }
    }

    assert.strictEqual(
      missing.length,
      0,
      `Found undefined DOM handler functions: ${missing.join(", ")}`
    );
  });

  test("should correctly link required external CSS and script assets", () => {
    assert.match(htmlContent, /<link\s+rel="stylesheet"\s+href="src\/styles\/studio\.css"/);
    assert.match(htmlContent, /<script\s+src="src\/prompts\/agentPrompts\.js"><\/script>/);
    assert.match(htmlContent, /<script\s+src="src\/controllers\/studioAudioSubtitles\.js"><\/script>/);
  });
});
