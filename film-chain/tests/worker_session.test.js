import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";

// Mock in-memory KV for testing worker.js
class MockKV {
  constructor() {
    this.store = new Map();
  }
  async get(key, options = {}) {
    const val = this.store.get(key);
    if (!val) return null;
    if (options.type === "arrayBuffer") {
      if (val instanceof ArrayBuffer) return val;
      if (val instanceof Uint8Array) return val.buffer;
      const enc = new TextEncoder();
      return enc.encode(String(val)).buffer;
    }
    if (typeof val !== "string") {
      const dec = new TextDecoder();
      return dec.decode(val);
    }
    return val;
  }
  async put(key, val) {
    this.store.set(key, val);
  }
}

test("Cloudflare Worker - Session Relay API Tests", async (t) => {
  const mockKV = new MockKV();
  const env = { FILM_CHAIN_KV: mockKV };

  await t.test("should return default waiting status for new session", async () => {
    const req = new Request("https://film-chain.onlytest.dev/api/session/test_123/status");
    const res = await worker.fetch(req, env);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.session_id, "test_123");
    assert.equal(data.status, "waiting");
    assert.equal(data.percent, 0);
  });

  await t.test("should update and retrieve session status correctly", async () => {
    const updateReq = new Request("https://film-chain.onlytest.dev/api/session/test_123/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stage: "part1",
        step_index: 1,
        total_steps: 3,
        percent: 33,
        title: "Part 1 (0-5s)",
        log: "Colab A100 推論進行中...",
        status: "running"
      }),
    });
    const updateRes = await worker.fetch(updateReq, env);
    assert.equal(updateRes.status, 200);

    const getReq = new Request("https://film-chain.onlytest.dev/api/session/test_123/status");
    const getRes = await worker.fetch(getReq, env);
    assert.equal(getRes.status, 200);
    const data = await getRes.json();
    assert.equal(data.stage, "part1");
    assert.equal(data.percent, 33);
    assert.equal(data.log, "Colab A100 推論進行中...");
  });

  await t.test("should upload video and serve with HTTP Range 206 support", async () => {
    // Fake 100 bytes MP4 video data
    const fakeVideoData = new Uint8Array(100);
    for (let i = 0; i < 100; i++) fakeVideoData[i] = i;

    const uploadReq = new Request("https://film-chain.onlytest.dev/api/session/test_123/video", {
      method: "POST",
      headers: { "Content-Type": "video/mp4" },
      body: fakeVideoData.buffer,
    });
    const uploadRes = await worker.fetch(uploadReq, env);
    assert.equal(uploadRes.status, 200);
    const uploadJson = await uploadRes.json();
    assert.equal(uploadJson.ok, true);
    assert.equal(uploadJson.size_bytes, 100);

    // Verify session status updated to completed
    const getReq = new Request("https://film-chain.onlytest.dev/api/session/test_123/status");
    const getRes = await worker.fetch(getReq, env);
    const statusData = await getRes.json();
    assert.equal(statusData.status, "completed");
    assert.equal(statusData.percent, 100);
    assert.equal(statusData.video_ready, true);

    // Full video GET (200)
    const fullGetReq = new Request("https://film-chain.onlytest.dev/api/session/test_123/video");
    const fullRes = await worker.fetch(fullGetReq, env);
    assert.equal(fullRes.status, 200);
    assert.equal(fullRes.headers.get("Content-Type"), "video/mp4");
    assert.equal(fullRes.headers.get("Content-Length"), "100");

    // Range video GET (206 Partial Content)
    const rangeReq = new Request("https://film-chain.onlytest.dev/api/session/test_123/video", {
      headers: { "Range": "bytes=10-19" },
    });
    const rangeRes = await worker.fetch(rangeReq, env);
    assert.equal(rangeRes.status, 206);
    assert.equal(rangeRes.headers.get("Content-Range"), "bytes 10-19/100");
    assert.equal(rangeRes.headers.get("Content-Length"), "10");
    const chunkBuf = await rangeRes.arrayBuffer();
    const chunkArr = new Uint8Array(chunkBuf);
    assert.equal(chunkArr.length, 10);
    assert.equal(chunkArr[0], 10);
    assert.equal(chunkArr[9], 19);
  });

  await t.test("should store and retrieve storyboard manifest", async () => {
    const testManifest = {
      project_name: "Test Film",
      segments: [
        { index: 1, title: "Part 1", prompt: "A robot opens eyes", end_panel: 3 },
        { index: 2, title: "Part 2", prompt: "A robot stands up", end_panel: 6 }
      ]
    };
    const postReq = new Request("https://film-chain.onlytest.dev/api/session/test_123/manifest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testManifest)
    });
    const postRes = await worker.fetch(postReq, env);
    assert.equal(postRes.status, 200);

    const getReq = new Request("https://film-chain.onlytest.dev/api/session/test_123/manifest");
    const getRes = await worker.fetch(getReq, env);
    assert.equal(getRes.status, 200);
    const data = await getRes.json();
    assert.equal(data.project_name, "Test Film");
    assert.equal(data.segments.length, 2);

    // Test PATCH reroll_target
    const patchReq = new Request("https://film-chain.onlytest.dev/api/session/test_123/manifest", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reroll_target: { part_index: 2, mode: "single", prompt: "Updated prompt 2" }
      })
    });
    const patchRes = await worker.fetch(patchReq, env);
    assert.equal(patchRes.status, 200);

    const getPatchedReq = new Request("https://film-chain.onlytest.dev/api/session/test_123/manifest");
    const getPatchedRes = await worker.fetch(getPatchedReq, env);
    const patchedData = await getPatchedRes.json();
    assert.equal(patchedData.project_name, "Test Film");
    assert.equal(patchedData.reroll_target.part_index, 2);
    assert.equal(patchedData.reroll_target.mode, "single");
  });

  await t.test("should upload and retrieve reference image binary", async () => {
    const fakeImgData = new Uint8Array([255, 216, 255, 224, 0, 16, 74, 70, 73, 70]); // JPEG magic header
    const postReq = new Request("https://film-chain.onlytest.dev/api/session/test_123/image", {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: fakeImgData.buffer
    });
    const postRes = await worker.fetch(postReq, env);
    assert.equal(postRes.status, 200);
    const postData = await postRes.json();
    assert.equal(postData.ok, true);

    const getReq = new Request("https://film-chain.onlytest.dev/api/session/test_123/image");
    const getRes = await worker.fetch(getReq, env);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.headers.get("Content-Type"), "image/jpeg");
    const imgBuf = await getRes.arrayBuffer();
    assert.equal(imgBuf.byteLength, 10);
  });

  await t.test("should handle cancel signal and report cancellation", async () => {
    const postReq = new Request("https://film-chain.onlytest.dev/api/session/test_123/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "使用者要求中止" })
    });
    const postRes = await worker.fetch(postReq, env);
    assert.equal(postRes.status, 200);
    const postData = await postRes.json();
    assert.equal(postData.cancelled, true);

    const getReq = new Request("https://film-chain.onlytest.dev/api/session/test_123/cancel");
    const getRes = await worker.fetch(getReq, env);
    assert.equal(getRes.status, 200);
    const data = await getRes.json();
    assert.equal(data.cancelled, true);
    assert.equal(data.reason, "使用者要求中止");
  });

  await t.test("should reject proxy call when target URL is missing", async () => {
    const req = new Request("https://film-chain.onlytest.dev/api/proxy");
    const res = await worker.fetch(req, env);
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /缺少目標 URL/);
  });

  await t.test("should route /api/proxy/fal prefix to queue.fal.run", async () => {
    // Intercept global fetch for testing
    const originalFetch = globalThis.fetch;
    let interceptedUrl = "";
    let interceptedAuth = "";
    globalThis.fetch = async (url, options) => {
      interceptedUrl = String(url);
      interceptedAuth = options.headers.get("Authorization");
      return new Response(JSON.stringify({ ok: true, video: { url: "https://fal.media/sample.mp4" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    };

    try {
      const req = new Request("https://film-chain.onlytest.dev/api/proxy/fal/fal-ai/minimax-video/image-to-video", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Api-Key": "fal_test_secret_key"
        },
        body: JSON.stringify({ prompt: "A running shisa lion" })
      });
      const res = await worker.fetch(req, env);
      assert.equal(res.status, 200);
      assert.equal(interceptedUrl, "https://queue.fal.run/fal-ai/minimax-video/image-to-video");
      assert.equal(interceptedAuth, "Key fal_test_secret_key");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test("should route /api/proxy/minimax prefix to api.minimax.chat", async () => {
    const originalFetch = globalThis.fetch;
    let interceptedUrl = "";
    let interceptedAuth = "";
    globalThis.fetch = async (url, options) => {
      interceptedUrl = String(url);
      interceptedAuth = options.headers.get("Authorization");
      return new Response(JSON.stringify({ task_id: "123456" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    };

    try {
      const req = new Request("https://film-chain.onlytest.dev/api/proxy/minimax/video_generation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Api-Key": "minimax_test_key"
        },
        body: JSON.stringify({ prompt: "A smiling shisa lion" })
      });
      const res = await worker.fetch(req, env);
      assert.equal(res.status, 200);
      assert.equal(interceptedUrl, "https://api.minimax.chat/v1/video_generation");
      assert.equal(interceptedAuth, "Bearer minimax_test_key");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test("should store and retrieve cross-device project snapshot via /api/project/:id", async () => {
    const sampleBundle = JSON.stringify({
      magic: "FILMCHAIN_PROJECT_V1",
      version: "1.0.0",
      project: { id: "fc_test_sync", name: "雲端接力專案", plan: { segments: [] } }
    });

    const postReq = new Request("https://film-chain.onlytest.dev/api/project/fc_test_sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: sampleBundle
    });
    const postRes = await worker.fetch(postReq, env);
    assert.equal(postRes.status, 200);

    const getReq = new Request("https://film-chain.onlytest.dev/api/project/fc_test_sync");
    const getRes = await worker.fetch(getReq, env);
    assert.equal(getRes.status, 200);
    const data = await getRes.json();
    assert.equal(data.project.name, "雲端接力專案");
  });
});
