const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const cloudAdapter = require('../public/src/core/cloudApiAdapter.js');

describe('H3 Storyboard Studio - Cloud API Adapter Tests', () => {

  // ==================== 1. estimateCost ====================
  describe('estimateCost', () => {
    it('should correctly calculate fal.ai estimated cost in USD', () => {
      const cost1 = cloudAdapter.estimateCost('fal', 3);
      assert.equal(cost1.currency, 'USD');
      assert.equal(cost1.perSegment, '0.15');
      assert.equal(cost1.total, '0.45');
      assert.match(cost1.desc, /\$0.45 USD/);

      const cost2 = cloudAdapter.estimateCost('fal', 4);
      assert.equal(cost2.total, '0.60');
    });

    it('should correctly calculate MiniMax estimated cost in RMB', () => {
      const cost1 = cloudAdapter.estimateCost('minimax', 3);
      assert.equal(cost1.currency, 'RMB');
      assert.equal(cost1.perSegment, '0.50');
      assert.equal(cost1.total, '1.50');
      assert.match(cost1.desc, /¥1.50 RMB/);
    });
  });

  // ==================== 2. FalClient ====================
  describe('FalClient', () => {
    it('should throw error when apiKey or prompt is missing', async () => {
      await assert.rejects(
        () => cloudAdapter.FalClient.submitTask({ apiKey: '', prompt: 'hello' }),
        /缺少 fal.ai API Key/
      );
      await assert.rejects(
        () => cloudAdapter.FalClient.submitTask({ apiKey: 'key123', prompt: '' }),
        /缺少生成 Prompt/
      );
    });

    it('should successfully submit task and return requestId', async () => {
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = async (url, opts) => {
          assert.equal(opts.headers['X-User-Api-Key'], 'fal_key_test');
          const body = JSON.parse(opts.body);
          assert.equal(body.prompt, 'a running cat');
          return new Response(JSON.stringify({ request_id: 'req_98765' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        };

        const res = await cloudAdapter.FalClient.submitTask({
          apiKey: 'fal_key_test',
          prompt: 'a running cat',
          proxyBase: 'https://film-chain.onlytest.dev/api/proxy/fal'
        });
        assert.equal(res.requestId, 'req_98765');
        assert.equal(res.direct, false);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('should poll fal.ai until COMPLETED and return videoUrl', async () => {
      const originalFetch = globalThis.fetch;
      let pollCount = 0;
      try {
        globalThis.fetch = async (url) => {
          if (String(url).endsWith('/status')) {
            pollCount++;
            const status = pollCount >= 2 ? 'COMPLETED' : 'IN_PROGRESS';
            return new Response(JSON.stringify({ status }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          // Result endpoint
          return new Response(JSON.stringify({ video: { url: 'https://fal.media/cat_video.mp4' } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        };

        const result = await cloudAdapter.FalClient.pollTask({
          apiKey: 'fal_key_test',
          requestId: 'req_98765',
          proxyBase: 'https://film-chain.onlytest.dev/api/proxy/fal',
          intervalMs: 10,
        });

        assert.equal(result.videoUrl, 'https://fal.media/cat_video.mp4');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  // ==================== 3. MiniMaxClient ====================
  describe('MiniMaxClient', () => {
    it('should submit task and poll until Success', async () => {
      const originalFetch = globalThis.fetch;
      let queryCount = 0;
      try {
        globalThis.fetch = async (url, opts) => {
          if (opts && opts.method === 'POST') {
            return new Response(JSON.stringify({ task_id: 'task_mm_123' }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          // Query
          queryCount++;
          const status = queryCount >= 2 ? 'Success' : 'Processing';
          return new Response(JSON.stringify({ status, download_url: 'https://minimax.cdn/lion.mp4' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        };

        const submitRes = await cloudAdapter.MiniMaxClient.submitTask({
          apiKey: 'mm_key',
          prompt: 'lion roaring',
          proxyBase: 'https://film-chain.onlytest.dev/api/proxy/minimax'
        });
        assert.equal(submitRes.taskId, 'task_mm_123');

        const pollRes = await cloudAdapter.MiniMaxClient.pollTask({
          apiKey: 'mm_key',
          taskId: submitRes.taskId,
          proxyBase: 'https://film-chain.onlytest.dev/api/proxy/minimax',
          intervalMs: 10,
        });
        assert.equal(pollRes.videoUrl, 'https://minimax.cdn/lion.mp4');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  // ==================== 4. runCloudPipeline ====================
  describe('runCloudPipeline', () => {
    it('should run parallel mode for all segments simultaneously', async () => {
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = async (url, opts) => {
          if (opts && opts.method === 'POST') {
            return new Response(JSON.stringify({ request_id: 'req_par_' + Math.random() }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (String(url).endsWith('/status')) {
            return new Response(JSON.stringify({ status: 'COMPLETED' }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return new Response(JSON.stringify({ video: { url: 'https://fal.media/segment_out.mp4' } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        };

        const completedParts = [];
        const segments = [
          { id: 1, prompt: "Part 1 prompt" },
          { id: 2, prompt: "Part 2 prompt" },
        ];

        const results = await cloudAdapter.runCloudPipeline({
          provider: 'fal',
          apiKey: 'test_key',
          segments,
          mode: 'parallel',
          proxyBase: 'https://film-chain.onlytest.dev/api/proxy/fal',
          onSegmentComplete: (idx, url) => completedParts.push({ idx, url }),
        });

        assert.equal(results.length, 2);
        assert.equal(completedParts.length, 2);
        assert.equal(completedParts[0].url, 'https://fal.media/segment_out.mp4');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

});
