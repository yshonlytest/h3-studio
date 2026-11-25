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
    "../public/src/controllers/workspaceSync.js",
    "../public/src/core/timecodeHelper.js",
    "../public/src/core/promptBuilder.js",
    "../public/src/core/comfyPayload.js",
    "../public/src/core/cloudDiagnostics.js",
    "../public/src/core/cloudApiAdapter.js",
    "../public/src/core/audioStudio.js",
    "../public/src/core/projectStore.js"
  ];

  const windowBindingsPath = path.resolve(__dirname, "../client/registry/windowBindings.ts");
  const windowBindingsContent = fs.readFileSync(windowBindingsPath, "utf-8");

  function readTsFilesRecursively(dir) {
    if (!fs.existsSync(dir)) return "";
    let out = "";
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out += readTsFilesRecursively(full);
      } else if (entry.isFile() && entry.name.endsWith(".ts")) {
        out += "\n" + fs.readFileSync(full, "utf-8");
      }
    }
    return out;
  }

  let combinedJs = htmlContent;
  for (const rel of jsFiles) {
    const full = path.resolve(__dirname, rel);
    if (fs.existsSync(full)) {
      combinedJs += "\n" + fs.readFileSync(full, "utf-8");
    }
  }
  combinedJs += readTsFilesRecursively(path.resolve(__dirname, "../client"));

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

    // Check that each invoked function is declared and registered on windowBindings.ts
    const missing = [];
    const unbound = [];
    for (const fn of invokedFunctions) {
      const declRegex = new RegExp(
        `(function\\s+${fn}\\b|\\bwindow\\.${fn}\\s*=|\\b${fn}\\s*=\\s*(async\\s+)?function|\\bclass\\s+${fn}\\b|\\bconst\\s+${fn}\\s*=|\\blet\\s+${fn}\\s*=|\\bvar\\s+${fn}\\s*=)`
      );
      if (!declRegex.test(combinedJs)) {
        missing.push(fn);
      }
      const bindingRegex = new RegExp(`\\b${fn}\\b`);
      if (!bindingRegex.test(windowBindingsContent)) {
        unbound.push(fn);
      }
    }

    assert.strictEqual(
      missing.length,
      0,
      `Found undefined DOM handler functions: ${missing.join(", ")}`
    );
    assert.strictEqual(
      unbound.length,
      0,
      `Found DOM handler functions missing from windowBindings.ts: ${unbound.join(", ")}`
    );
  });

  test("should correctly link required external CSS and script assets", () => {
    assert.match(htmlContent, /<link\s+rel="stylesheet"\s+href="src\/styles\/studio\.css"/);
    assert.match(htmlContent, /<script\s+src="src\/prompts\/agentPrompts\.js"><\/script>/);
    assert.match(htmlContent, /<script\s+src="dist\/studio\.js"><\/script>/);
    assert.doesNotMatch(htmlContent, /studioAudioSubtitles\.js/);
  });

  test("should have zero inline script blocks and parse built studio bundle without syntax errors", () => {
    const vm = require("node:vm");
    const scriptRegex = /<script(?:\s+type="([^"]*)")?>([\s\S]*?)<\/script>/gi;
    let match;
    let count = 0;
    while ((match = scriptRegex.exec(htmlContent)) !== null) {
      const type = match[1] || "text/javascript";
      if (!type || type === "text/javascript") {
        count++;
      }
    }
    assert.strictEqual(count, 0, `Expected 0 inline script blocks in index.html, found ${count}`);
    assert.ok(htmlContent.split("\n").length < 1500, `Expected index.html < 1500 lines, got ${htmlContent.split("\n").length}`);

    const studioBundlePath = path.resolve(__dirname, "../public/dist/studio.js");
    assert.ok(fs.existsSync(studioBundlePath), "Expected built bundle public/dist/studio.js to exist");
    const bundleContent = fs.readFileSync(studioBundlePath, "utf-8");
    assert.doesNotThrow(() => {
      new vm.Script(bundleContent, { filename: "public/dist/studio.js" });
    }, "Built public/dist/studio.js has syntax errors");
  });

  test("should have zero duplicate DOM element IDs and place Colab rendering actions strictly in Step 3", () => {
    const idRegex = /\bid="([^"]+)"/g;
    const idCounts = new Map();
    for (const match of htmlContent.matchAll(idRegex)) {
      const id = match[1];
      idCounts.set(id, (idCounts.get(id) || 0) + 1);
    }
    const duplicates = Array.from(idCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([id, count]) => `${id} (x${count})`);

    assert.strictEqual(
      duplicates.length,
      0,
      `Found duplicate DOM IDs in index.html: ${duplicates.join(", ")}`
    );

    assert.ok(!htmlContent.includes('id="step1ColabPromptBox"'), "step1ColabPromptBox must be removed from Step 1");
    assert.ok(htmlContent.includes('id="downloadColabManifestBtn"'), "Step 3 must include downloadColabManifestBtn");
    assert.ok(htmlContent.includes('id="copyColabPromptBtn"'), "Step 3 must include unique copyColabPromptBtn");
    assert.ok(htmlContent.includes('id="colabPromptTextarea"'), "Step 3 must include unique colabPromptTextarea");
  });

  test("should execute built studio.js bundle and load all 3 golden demo templates without errors", async () => {
    const vm = require("node:vm");

    function createMockElement(id, tag = "div") {
      let innerHtmlValue = "";
      return {
        id,
        tagName: tag.toUpperCase(),
        value: "",
        textContent: "",
        get innerHTML() {
          return innerHtmlValue;
        },
        set innerHTML(v) {
          innerHtmlValue = String(v);
          if (innerHtmlValue === "") this.children = [];
        },
        src: "",
        href: "",
        disabled: false,
        checked: false,
        style: {},
        dataset: {},
        children: [],
        options: [],
        selectedIndex: 0,
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        addEventListener() {},
        removeEventListener() {},
        appendChild(child) { this.children.push(child); return child; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        closest() { return null; },
        focus() {},
        click() {},
        load() {},
        play() { return Promise.resolve(); },
        setAttribute() {},
        getAttribute() { return null; },
        removeAttribute() {},
        scrollIntoView() {},
        getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; },
        getContext() { return new Proxy({}, { get() { return () => {}; } }); },
      };
    }

    const elements = new Map();
    for (const match of htmlContent.matchAll(/\bid="([^"]+)"/g)) {
      elements.set(match[1], createMockElement(match[1]));
    }

    const winListeners = {};
    const docListeners = {};
    const mockDoc = {
      readyState: "loading",
      getElementById(id) { return elements.get(id) || null; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      createElement(tag) { return createMockElement("", tag); },
      addEventListener(ev, fn) { (docListeners[ev] ||= []).push(fn); },
      removeEventListener() {},
      body: createMockElement("body", "body"),
      head: createMockElement("head", "head"),
      documentElement: createMockElement("html", "html"),
    };

    const storage = new Map();
    const localStorageMock = {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    };

    const trackedTimers = new Set();
    const silentConsole = { ...console, debug() {}, warn() {}, log() {} };
    const sandbox = {
      console: silentConsole,
      setTimeout: (fn, ms) => {
        const t = setTimeout(fn, ms);
        trackedTimers.add(t);
        return t;
      },
      clearTimeout: (t) => { trackedTimers.delete(t); clearTimeout(t); },
      setInterval: (fn, ms) => {
        const t = setInterval(fn, ms);
        trackedTimers.add(t);
        return t;
      },
      clearInterval: (t) => { trackedTimers.delete(t); clearInterval(t); },
      URL,
      URLSearchParams,
      Blob,
      FileReader: function FileReaderMock() {},
      Image: function ImageMock() {},
      navigator: { clipboard: { writeText: () => Promise.resolve() }, userAgent: "node-test" },
      location: {
        href: "https://film-chain.onlytest.dev/",
        pathname: "/",
        search: "",
        origin: "https://film-chain.onlytest.dev",
        protocol: "https:",
        host: "film-chain.onlytest.dev",
      },
      history: { replaceState() {} },
      fetch: () => Promise.resolve({ ok: false, status: 404, text: async () => "", json: async () => ({}) }),
      document: mockDoc,
      localStorage: localStorageMock,
      addEventListener(ev, fn) { (winListeners[ev] ||= []).push(fn); },
      removeEventListener() {},
      alert() {},
      confirm() { return true; },
      prompt() { return ""; },
      crypto: globalThis.crypto,
    };
    sandbox.window = sandbox;
    sandbox.self = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);

    try {
      const orderedScripts = [
        "../public/src/core/timecodeHelper.js",
        "../public/src/prompts/agentPrompts.js",
        "../public/src/core/promptBuilder.js",
        "../public/src/core/comfyPayload.js",
        "../public/src/core/cloudDiagnostics.js",
        "../public/src/core/cloudApiAdapter.js",
        "../public/src/core/audioStudio.js",
        "../public/src/core/projectStore.js",
        "../public/dist/studio.js",
        "../public/src/controllers/workspaceSync.js",
      ];
      for (const rel of orderedScripts) {
        const full = path.resolve(__dirname, rel);
        vm.runInContext(fs.readFileSync(full, "utf-8"), sandbox, { filename: rel });
      }

      for (const fn of winListeners.DOMContentLoaded || []) await fn();
      for (const fn of docListeners.DOMContentLoaded || []) await fn();

      assert.strictEqual(typeof sandbox.loadGoldenTemplate, "function", "window.loadGoldenTemplate must be bound");

      const expectations = [
        { key: "tutorial_140s", namePart: "H3 工作流教學", segments: 14, video: "assets/demo/tutorial_140s_merged.mp4" },
        { key: "detective", namePart: "賽博偵探", segments: 5, video: "assets/demo/detective_25s_merged.mp4" },
        { key: "ink_sorcerer", namePart: "墨繪靈境", segments: 5, video: "assets/demo/ink_sorcerer_25s_merged.mp4" },
      ];

      for (const exp of expectations) {
        await sandbox.loadGoldenTemplate(exp.key);
        const projName = mockDoc.getElementById("currentProjectNameInput").value;
        const descVal = mockDoc.getElementById("chineseDesc").value;
        const segCount = mockDoc.getElementById("segmentsContainer").children.length;
        const videoSrc = mockDoc.getElementById("mainVideoPlayer").src;
        const statusHtml = mockDoc.getElementById("planStatusMsg").innerHTML;

        assert.ok(projName.includes(exp.namePart), `${exp.key} project name "${projName}" missing "${exp.namePart}"`);
        assert.ok(descVal.length > 10, `${exp.key} description should be populated`);
        assert.strictEqual(segCount, exp.segments, `${exp.key} expected ${exp.segments} rendered segments, got ${segCount}`);
        assert.strictEqual(videoSrc, exp.video, `${exp.key} expected video ${exp.video}, got ${videoSrc}`);
        assert.ok(statusHtml.includes("✅ 已載入"), `${exp.key} expected loaded status badge, got "${statusHtml}"`);
      }
    } finally {
      for (const t of trackedTimers) {
        clearTimeout(t);
        clearInterval(t);
      }
      trackedTimers.clear();
    }
  });
});
