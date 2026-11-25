import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { escapeHtml, sanitizeTrustedTooltipHtml, sanitizeUrl } from "../client/utils/domSafety.ts";
import { renderPhoneticHintBadge } from "../client/features/phoneticsLexicon.ts";
import { storyboardStore } from "../client/stores/storyboardStore.ts";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.resolve(TEST_DIR, "../client");

describe("DOM Safety - URL Allowlist, HTML Escaping & Sink Regressions", () => {
  it("escapeHtml escapes HTML special characters and quotes", () => {
    assert.equal(escapeHtml(null), "");
    assert.equal(escapeHtml(undefined), "");
    assert.equal(escapeHtml(0), "0");
    assert.equal(
      escapeHtml(`<script>alert("xss" & '1')</script>`),
      "&lt;script&gt;alert(&quot;xss&quot; &amp; &#039;1&#039;)&lt;/script&gt;"
    );
  });

  it("sanitizeUrl permits only allowlisted schemes and blocks injection/control-char payloads", () => {
    assert.equal(sanitizeUrl("https://cdn.example.com/video.mp4"), "https://cdn.example.com/video.mp4");
    assert.equal(sanitizeUrl("http://127.0.0.1:8080/outputs/shot_1.mp4"), "http://127.0.0.1:8080/outputs/shot_1.mp4");
    assert.equal(sanitizeUrl("blob:http://127.0.0.1:8080/abc-123"), "blob:http://127.0.0.1:8080/abc-123");
    assert.equal(sanitizeUrl("assets/demo/p1.mp4"), "assets/demo/p1.mp4");
    assert.equal(
      sanitizeUrl("data:image/png;base64,iVBORw0KGgo=", { allowDataImage: true }),
      "data:image/png;base64,iVBORw0KGgo="
    );

    assert.equal(sanitizeUrl("javascript:alert(1)"), "");
    assert.equal(sanitizeUrl("JaVaScRiPt:alert(1)"), "");
    assert.equal(sanitizeUrl("java\tscript:alert(1)"), "");
    assert.equal(sanitizeUrl("java script:alert(1)"), "");
    assert.equal(sanitizeUrl("vbscript:msgbox(1)"), "");
    assert.equal(sanitizeUrl("data:text/html,<script>alert(1)</script>"), "");
    assert.equal(sanitizeUrl("data:image/svg+xml;base64,PHN2Zz4=", { allowDataImage: true }), "");
    assert.equal(sanitizeUrl("//evil.example.com/payload.mp4"), "");
    assert.equal(sanitizeUrl('https://x.com/" onmouseover="alert(1)'), "");
  });

  it("sanitizeTrustedTooltipHtml strips scripts, event handlers, and javascript URLs while keeping safe tags", () => {
    const raw = `<strong>💡 提示</strong><br><a href="https://example.com" onclick="alert(1)">文件</a><a href="javascript:alert(2)">壞連結</a><img src=x onerror="alert(3)"><script>alert(4)</script>`;
    const clean = sanitizeTrustedTooltipHtml(raw);
    assert.equal(clean.includes("<script"), false);
    assert.equal(clean.includes("onclick"), false);
    assert.equal(clean.includes("onerror"), false);
    assert.equal(clean.includes("javascript:"), false);
    assert.equal(clean.includes("<strong>💡 提示</strong>"), true);
    assert.equal(clean.includes('href="https://example.com"'), true);
  });

  it("renderPhoneticHintBadge escapes lexicon keys and replacements safely", () => {
    storyboardStore.reset();
    try {
      storyboardStore.setLexiconData({
        "zh-TW": {
          "測試<img src=x onerror=alert(1)>": "替換'\"<script>",
        },
      });
      const badgeHtml = renderPhoneticHintBadge("這句有測試<img src=x onerror=alert(1)>詞");
      assert.equal(badgeHtml.includes("<img"), false);
      assert.equal(badgeHtml.includes("<script>"), false);
      assert.equal(badgeHtml.includes("&lt;img"), true);
      assert.equal(badgeHtml.includes("&#039;&quot;&lt;script&gt;"), true);
    } finally {
      storyboardStore.reset();
    }
  });

  it("prevents textarea breakout, quote-escaped inline string args, and legacy CLI strings", () => {
    const editorSrc = fs.readFileSync(path.join(CLIENT_DIR, "features/storyboardEditor.ts"), "utf-8");
    const playerSrc = fs.readFileSync(path.join(CLIENT_DIR, "features/stagePlayer.ts"), "utf-8");
    const lexiconSrc = fs.readFileSync(path.join(CLIENT_DIR, "features/phoneticsLexicon.ts"), "utf-8");

    assert.equal(editorSrc.includes("${seg.prompt"), false, "appendSegmentCardDOM must set textarea .value, not interpolate prompt HTML");
    assert.equal(playerSrc.includes("${escapeHtml(promptVal)}</textarea>"), false, "renderSegmentsPlaylist must set textarea .value, not interpolate HTML");
    assert.equal(playerSrc.includes("playVideoInStage('${item.url}'"), false, "playlist play button must use integer playPlaylistItem(idx)");
    assert.equal(lexiconSrc.includes("deleteLexiconRule('${escapeHtml(orig)}')"), false, "delete button must read data-lexicon-key, not string-interpolated onclick arg");
    assert.equal(editorSrc.includes("pipeline/h3_storyboard_pipeline.py"), false, "legacy bare h3_storyboard_pipeline.py command must not appear");
    assert.equal(playerSrc.includes("skills/minimax-h3-colab/scripts/runner.py"), false, "legacy bare runner.py command must not appear");
  });
});
