import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { coreStore } from "../client/stores/coreStore.ts";
import { registerWindowBindings } from "../client/registry/windowBindings.ts";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const FILM_CHAIN_ROOT = path.resolve(TEST_DIR, "..");
const CLIENT_DIR = path.join(FILM_CHAIN_ROOT, "client");
const CORE_JS_DIR = path.join(FILM_CHAIN_ROOT, "public", "src", "core");

function listTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      results.push(full);
    }
  }
  return results;
}

export function extractImportSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const patterns = [
    /(?:import|export)\s+(?:type\s+)?[\s\S]*?\sfrom\s+["']([^"']+)["']/g,
    /^\s*import\s+["']([^"']+)["']/gm,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const regex of patterns) {
    for (const m of source.matchAll(regex)) {
      specs.push(m[1]);
    }
  }
  return specs;
}

describe("Architecture Unidirectional Boundaries & Bridge Contracts", () => {
  it("enforces unidirectional dependencies for types, config, utils, data, and domain stores", () => {
    const restrictedDirs = ["types", "config", "utils", "data", "stores"];
    const forbiddenSegments = ["features", "registry", "bootstrap", "main"];

    for (const sub of restrictedDirs) {
      const files = listTsFiles(path.join(CLIENT_DIR, sub));
      assert.ok(files.length > 0, `Expected .ts files in client/${sub}`);
      for (const file of files) {
        const relFile = path.relative(CLIENT_DIR, file);
        const imports = extractImportSpecifiers(fs.readFileSync(file, "utf-8"));
        for (const spec of imports) {
          for (const bad of forbiddenSegments) {
            assert.ok(
              !spec.includes(`/${bad}`) && !spec.startsWith(`./${bad}`),
              `${relFile} must not import "${spec}" from upper layer "${bad}"`
            );
          }
          if (sub === "types" || sub === "config" || sub === "utils" || sub === "data") {
            assert.ok(
              !spec.includes("/stores"),
              `${relFile} must not import store module "${spec}"`
            );
          }
        }
      }
    }

    const createStoreSrc = fs.readFileSync(path.join(CLIENT_DIR, "stores", "createStore.ts"), "utf-8");
    assert.deepEqual(
      extractImportSpecifiers(createStoreSrc),
      [],
      "createStore.ts must remain self-contained with zero imports"
    );

    const domainStores = ["coreStore.ts", "storyboardStore.ts", "computeStore.ts", "audioSubtitleStore.ts"];
    const allowedStoreImports = new Set(["./createStore.ts", "../types/studio.ts"]);
    for (const storeFile of domainStores) {
      const fullPath = path.join(CLIENT_DIR, "stores", storeFile);
      const imports = extractImportSpecifiers(fs.readFileSync(fullPath, "utf-8"));
      for (const spec of imports) {
        assert.ok(
          allowedStoreImports.has(spec),
          `Domain store ${storeFile} imported unexpected module "${spec}"`
        );
      }
    }
  });

  it("ensures public/src/core/*.js stays UI-agnostic without DOM queries or store imports", () => {
    const coreFiles = fs.readdirSync(CORE_JS_DIR).filter((f) => f.endsWith(".js"));
    assert.equal(coreFiles.length, 7, `Expected 7 UMD core JS modules, found ${coreFiles.length}`);
    const forbiddenCoreTokens = [
      "document.getElementById",
      "document.querySelector",
      "document.querySelectorAll",
      "document.body",
      ".innerHTML",
      ".outerHTML",
      "insertAdjacentHTML",
      "../client/",
      "coreStore",
      "storyboardStore",
      "computeStore",
      "audioSubtitleStore",
      "showToast",
    ];
    for (const filename of coreFiles) {
      const content = fs.readFileSync(path.join(CORE_JS_DIR, filename), "utf-8");
      for (const token of forbiddenCoreTokens) {
        assert.equal(
          content.includes(token),
          false,
          `public/src/core/${filename} must not couple to UI/DOM token "${token}"`
        );
      }
    }
  });

  it("verifies retired legacy bridge files and callLegacy shims are completely removed", () => {
    assert.equal(
      fs.existsSync(path.join(CLIENT_DIR, "stores", "legacyGlobalBridge.ts")),
      false,
      "legacyGlobalBridge.ts must be deleted"
    );
    assert.equal(
      fs.existsSync(path.join(FILM_CHAIN_ROOT, "public", "src", "controllers", "studioAudioSubtitles.js")),
      false,
      "studioAudioSubtitles.js must be deleted"
    );

    const sessionColabSrc = fs.readFileSync(path.join(CLIENT_DIR, "features", "sessionColab.ts"), "utf-8");
    assert.equal(
      /export\s+(?:async\s+)?function\s+_renderColabPipelineTrackerInner\b/.test(sessionColabSrc),
      false,
      "_renderColabPipelineTrackerInner must remain module-private"
    );

    for (const file of listTsFiles(CLIENT_DIR)) {
      const content = fs.readFileSync(file, "utf-8");
      assert.equal(
        content.includes("callLegacy"),
        false,
        `${path.relative(CLIENT_DIR, file)} still contains callLegacy`
      );
    }
  });

  it("exposes required DOM handlers and external window contracts without leaking internals", () => {
    const builtins = new Set([
      "if", "for", "while", "switch", "alert", "confirm", "prompt",
      "parseInt", "parseFloat", "Boolean", "Number", "String", "var", "let", "const",
      "click", "close", "showModal", "preventDefault", "stopPropagation",
      "focus", "blur", "select", "reset", "submit", "closest", "removeAttribute",
      "getElementById", "querySelectorAll", "scrollIntoView", "play", "pause",
      "setAttribute", "getAttribute", "contains", "add", "remove", "toggle",
    ]);
    const dynamicHandlers = new Set<string>();
    for (const file of listTsFiles(CLIENT_DIR)) {
      const content = fs.readFileSync(file, "utf-8");
      for (const m of content.matchAll(/on[a-z]+="([^"]+)"/gi)) {
        for (const fm of m[1].matchAll(/([a-zA-Z0-9_$]+)\s*\(/g)) {
          if (!builtins.has(fm[1])) {
            dynamicHandlers.add(fm[1]);
          }
        }
      }
    }

    const globalObj = globalThis as Record<string, unknown>;
    const hadWindow = Object.prototype.hasOwnProperty.call(globalObj, "window");
    const prevWindow = globalObj.window;
    globalObj.window = {} as Record<string, unknown>;

    try {
      coreStore.reset();
      registerWindowBindings();
      coreStore.setActiveProject("fc_arch_test", "Arch Test");

      const mockWindow = globalObj.window as Record<string, unknown>;
      for (const handlerName of dynamicHandlers) {
        assert.equal(
          typeof mockWindow[handlerName],
          "function",
          `Dynamic HTML inline handler "${handlerName}" must be bound on window`
        );
      }

      const requiredFns = [
        "showToast",
        "H3StudioApplyPlan",
        "applyPhoneticSubstitutions",
        "rerollShotAudio",
        "replaceShotSpeechOnly",
        "exportChainedManifest",
        "h3StudioStartLocalRender",
      ];
      for (const fnName of requiredFns) {
        assert.equal(typeof mockWindow[fnName], "function", `window.${fnName} must be a function`);
      }

      assert.equal(mockWindow.currentActiveProjectId, "fc_arch_test");
      const descriptor = Object.getOwnPropertyDescriptor(mockWindow, "currentActiveProjectId");
      assert.ok(descriptor && typeof descriptor.get === "function", "window.currentActiveProjectId must have getter");
      assert.equal(descriptor.set, undefined, "window.currentActiveProjectId must be read-only (no setter)");

      for (const leakedKey of [
        "currentPlan",
        "activeRoute",
        "currentPlaylist",
        "currentDialogueItems",
        "DEMO_PROJECT_CONFIG",
        "renderPlanUI",
        "syncSegmentsFromDOM",
        "getPrefs",
        "_renderColabPipelineTrackerInner",
      ]) {
        assert.equal(mockWindow[leakedKey], undefined, `window.${leakedKey} must not leak internal state or helpers`);
      }
    } finally {
      coreStore.reset();
      if (hadWindow) {
        globalObj.window = prevWindow;
      } else {
        delete globalObj.window;
      }
    }
  });
});
