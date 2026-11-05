/**
 * Cloudflare Worker for FilmChain Studio
 * 1. /api/proxy: 反向代理，解決外部雲端影片 API (Seedance / fal.ai) 跨域問題
 * 2. /api/session/:id/status: AI Agent 階段進度回報與查詢端點
 * 3. /api/session/:id/events: Server-Sent Events (SSE) 即時推播串流
 * 4. /api/session/:id/video: 最終無縫影片上傳暫存與 HTTP Range 快進串流播放
 * 5. 靜態前端資源託管 (Cloudflare Assets)
 */

function corsHeaders(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Range, X-Target-URL, X-Requested-With, X-User-Api-Key",
    "Access-Control-Expose-Headers": "Content-Range, Accept-Ranges, Content-Length",
    ...extra,
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ==================== CORS Preflight ====================
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders({ "Access-Control-Max-Age": "86400" }),
      });
    }

    // ==================== 1. Session Relay API ====================
    if (url.pathname.startsWith("/api/session/")) {
      const parts = url.pathname.split("/").filter(Boolean); // ['api', 'session', ':id', ':action']
      const sessionId = parts[2];
      const action = parts[3]; // 'status', 'video', 'events'

      if (!sessionId) {
        return new Response(JSON.stringify({ error: "Missing sessionId in URL" }), {
          status: 400,
          headers: corsHeaders({ "Content-Type": "application/json; charset=utf-8" }),
        });
      }

      const kv = env.FILM_CHAIN_KV;
      const r2 = env.VIDEO_BUCKET;

      // 1.1 GET /api/session/:id/status - 查詢進度
      if (request.method === "GET" && (!action || action === "status")) {
        let statusData = null;
        if (kv) {
          const raw = await kv.get(`session:${sessionId}:status`);
          if (raw) {
            try { statusData = JSON.parse(raw); } catch (e) {}
          }
        }
        if (!statusData) {
          statusData = {
            session_id: sessionId,
            status: "waiting",
            percent: 0,
            log: "等待 Agent 連線中...",
            updated_at: Date.now(),
          };
        }
        return new Response(JSON.stringify(statusData), {
          status: 200,
          headers: corsHeaders({ "Content-Type": "application/json; charset=utf-8" }),
        });
      }

      // 1.2 POST /api/session/:id/status - Agent 更新進度
      if (request.method === "POST" && action === "status") {
        try {
          const body = await request.json();
          const payload = {
            session_id: sessionId,
            stage: body.stage || "init",
            step_index: typeof body.step_index === "number" ? body.step_index : 0,
            total_steps: typeof body.total_steps === "number" ? body.total_steps : 1,
            percent: typeof body.percent === "number" ? body.percent : 0,
            title: body.title || "",
            log: body.log || "",
            status: body.status || "running", // 'running', 'completed', 'error'
            error_message: body.error_message || "",
            video_ready: !!body.video_ready,
            video_url: body.video_url || (body.video_ready ? `/api/session/${sessionId}/video` : ""),
            updated_at: Date.now(),
          };

          if (kv) {
            await kv.put(`session:${sessionId}:status`, JSON.stringify(payload), { expirationTtl: 86400 });
          }

          return new Response(JSON.stringify({ ok: true, data: payload }), {
            status: 200,
            headers: corsHeaders({ "Content-Type": "application/json; charset=utf-8" }),
          });
        } catch (err) {
          return new Response(JSON.stringify({ error: `無效的 JSON 請求: ${err.message}` }), {
            status: 400,
            headers: corsHeaders({ "Content-Type": "application/json; charset=utf-8" }),
          });
        }
      }

      // 1.25 GET / POST / PATCH /api/session/:id/manifest - 分鏡任務清單同步
      if (action === "manifest") {
        if (request.method === "PATCH") {
          try {
            const patchData = await request.json();
            let current = {};
            if (kv) {
              const raw = await kv.get(`session:${sessionId}:manifest`);
              if (raw) {
                try { current = JSON.parse(raw); } catch (e) {}
              }
              const merged = { ...current, ...patchData };
              await kv.put(`session:${sessionId}:manifest`, JSON.stringify(merged), { expirationTtl: 86400 });
            }
            return new Response(JSON.stringify({ ok: true, session_id: sessionId }), {
              status: 200,
              headers: corsHeaders({ "Content-Type": "application/json; charset=utf-8" }),
            });
          } catch (err) {
            return new Response(JSON.stringify({ error: `Manifest 更新失敗: ${err.message}` }), {
              status: 400,
              headers: corsHeaders({ "Content-Type": "application/json; charset=utf-8" }),
            });
          }
        }
        if (request.method === "POST" || request.method === "PUT") {
          try {
            const manifestData = await request.json();
            if (kv) {
              await kv.put(`session:${sessionId}:manifest`, JSON.stringify(manifestData), { expirationTtl: 86400 });
            }
            return new Response(JSON.stringify({ ok: true, session_id: sessionId }), {
              status: 200,
              headers: corsHeaders({ "Content-Type": "application/json; charset=utf-8" }),
            });
          } catch (err) {
            return new Response(JSON.stringify({ error: `Manifest 儲存失敗: ${err.message}` }), {
              status: 400,
              headers: corsHeaders({ "Content-Type": "application/json; charset=utf-8" }),
            });
          }
        }
        if (request.method === "GET") {
          let manifest = null;
          if (kv) {
            const raw = await kv.get(`session:${sessionId}:manifest`);
            if (raw) {
              try { manifest = JSON.parse(raw); } catch (e) {}
            }
          }
          if (!manifest) {
            return new Response(JSON.stringify({ error: "尚未上傳該 Session 的分鏡清單 (Manifest not found)" }), {
              status: 404,
              headers: corsHeaders({ "Content-Type": "application/json; charset=utf-8" }),
            });
          }
          return new Response(JSON.stringify(manifest), {
            status: 200,
            headers: corsHeaders({ "Content-Type": "application/json; charset=utf-8" }),
          });
        }
      }

      // 1.26 GET / POST / PUT /api/session/:id/image - 九宮格參考原圖二進位存取
      if (action === "image") {
        if (request.method === "POST" || request.method === "PUT") {
          try {
            const contentType = request.headers.get("content-type") || "image/jpeg";
            let imgBuffer;
            if (contentType.includes("multipart/form-data")) {
              const formData = await request.formData();
              const file = formData.get("file") || formData.get("image");
              if (!file || typeof file.arrayBuffer !== "function") {
                throw new Error("表單中未包含名為 file 或 image 的圖檔資料");
              }
              imgBuffer = await file.arrayBuffer();
            } else {
              imgBuffer = await request.arrayBuffer();
            }

            if (!imgBuffer || imgBuffer.byteLength === 0) {
              throw new Error("上傳的圖檔為空");
            }

            if (kv) {
              await kv.put(`session:${sessionId}:image`, imgBuffer, { expirationTtl: 86400 });
            }

            return new Response(JSON.stringify({
              ok: true,
              image_url: `/api/session/${sessionId}/image`,
              size_bytes: imgBuffer.byteLength,
            }), {
              status: 200,
              headers: corsHeaders({ "Content-Type": "application/json; charset=utf-8" }),
            });
          } catch (err) {
            return new Response(JSON.stringify({ error: `圖片儲存失敗: ${err.message}` }), {
              status: 400,
              headers: corsHeaders({ "Content-Type": "application/json; charset=utf-8" }),
            });
          }
        }
        if (request.method === "GET") {
          let imgBuffer = null;
          if (kv) {
            imgBuffer = await kv.get(`session:${sessionId}:image`, { type: "arrayBuffer" });
          }
          if (!imgBuffer) {
            return new Response(JSON.stringify({ error: "九宮格參考圖尚未上傳或已過期" }), {
              status: 404,
              headers: corsHeaders({ "Content-Type": "application/json; charset=utf-8" }),
            });
          }
          return new Response(imgBuffer, {
            status: 200,
            headers: corsHeaders({
              "Content-Type": "image/jpeg",
              "Content-Length": String(imgBuffer.byteLength),
              "Cache-Control": "public, max-age=3600",
            }),
          });
        }
      }

      // 1.27 POST / GET /api/session/:id/cancel - 任務中止控制信號
      if (action === "cancel") {
        if (request.method === "POST") {
          try {
            const body = await request.json().catch(() => ({}));
            const cancelData = {
              cancelled: true,
              reason: body.reason || "使用者手動中止生成",
              timestamp: Date.now(),
            };
            if (kv) {
              await kv.put(`session:${sessionId}:cancel`, JSON.stringify(cancelData), { expirationTtl: 86400 });
              // 同步更新 status
              const raw = await kv.get(`session:${sessionId}:status`);
              let s = { session_id: sessionId };
              if (raw) {
                try { s = JSON.parse(raw); } catch (e) {}
              }
              s.status = "cancelling";
              s.log = `[已發送中止信號] ${cancelData.reason}`;
              s.updated_at = Date.now();
              await kv.put(`session:${sessionId}:status`, JSON.stringify(s), { expirationTtl: 86400 });
            }
            return new Response(JSON.stringify({ ok: true, cancelled: true }), {
              status: 200,
              headers: corsHeaders({ "Content-Type": "application/json; charset=utf-8" }),
            });
          } catch (err) {
            return new Response(JSON.stringify({ error: err.message }), {
              status: 400,
              headers: corsHeaders({ "Content-Type": "application/json; charset=utf-8" }),
            });
          }
        }
        if (request.method === "GET") {
          let cancelData = { cancelled: false };
          if (kv) {
            const raw = await kv.get(`session:${sessionId}:cancel`);
            if (raw) {
              try { cancelData = JSON.parse(raw); } catch (e) {}
            }
          }
          return new Response(JSON.stringify(cancelData), {
            status: 200,
            headers: corsHeaders({ "Content-Type": "application/json; charset=utf-8" }),
          });
        }
      }

      // 1.3 GET /api/session/:id/events - SSE 即時推播串流
      if (request.method === "GET" && action === "events") {
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const encoder = new TextEncoder();

        // 立即發送首包當前狀態
        let currentStatus = { session_id: sessionId, status: "waiting", percent: 0 };
        if (kv) {
          const raw = await kv.get(`session:${sessionId}:status`);
          if (raw) {
            try { currentStatus = JSON.parse(raw); } catch (e) {}
          }
        }
        writer.write(encoder.encode(`data: ${JSON.stringify(currentStatus)}\n\n`));

        // 輪詢 KV 保持 30 秒 SSE 連線並推播最新異動
        let count = 0;
        let lastUpdated = currentStatus.updated_at || 0;
        const intervalId = setInterval(async () => {
          count++;
          if (count > 25) { // 保持 ~25 次後關閉，客戶端自動重新連線
            clearInterval(intervalId);
            writer.close().catch(() => {});
            return;
          }
          if (kv) {
            try {
              const raw = await kv.get(`session:${sessionId}:status`);
              if (raw) {
                const s = JSON.parse(raw);
                if (s.updated_at !== lastUpdated) {
                  lastUpdated = s.updated_at;
                  writer.write(encoder.encode(`data: ${JSON.stringify(s)}\n\n`));
                }
              }
            } catch (e) {}
          }
          // 定期發送 heartbeat 註解防超時
          writer.write(encoder.encode(`: ping\n\n`));
        }, 1200);

        return new Response(readable, {
          status: 200,
          headers: corsHeaders({
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
          }),
        });
      }

      // 1.4 POST/PUT /api/session/:id/video - Agent 上傳最終無縫 MP4
      if ((request.method === "POST" || request.method === "PUT") && action === "video") {
        try {
          const contentType = request.headers.get("content-type") || "";
          let videoBuffer;

          if (contentType.includes("multipart/form-data")) {
            const formData = await request.formData();
            const file = formData.get("file") || formData.get("video");
            if (!file || typeof file.arrayBuffer !== "function") {
              throw new Error("表單中未包含名為 file 或 video 的影片二進位資料");
            }
            videoBuffer = await file.arrayBuffer();
          } else {
            // 直接 raw 二進位流上傳
            videoBuffer = await request.arrayBuffer();
          }

          if (!videoBuffer || videoBuffer.byteLength === 0) {
            throw new Error("上傳的影片檔案大小為 0 位元組");
          }

          // 優先寫入 R2 儲存桶；若無 R2 則寫入 KV
          if (r2) {
            await r2.put(`sessions/${sessionId}/video.mp4`, videoBuffer, {
              httpMetadata: { contentType: "video/mp4" },
            });
          } else if (kv) {
            await kv.put(`session:${sessionId}:video`, videoBuffer, { expirationTtl: 86400 });
          }

          // 自動標記狀態為完成
          const completedPayload = {
            session_id: sessionId,
            stage: "complete",
            step_index: 999,
            total_steps: 999,
            percent: 100,
            title: "全片拼接已完成",
            log: "影片已安全直傳至雲端中繼站，已可於網頁直接串流播放或下載！",
            status: "completed",
            video_ready: true,
            video_url: `/api/session/${sessionId}/video`,
            video_bytes: videoBuffer.byteLength,
            updated_at: Date.now(),
          };

          if (kv) {
            await kv.put(`session:${sessionId}:status`, JSON.stringify(completedPayload), { expirationTtl: 86400 });
          }

          return new Response(JSON.stringify({
            ok: true,
            video_url: `/api/session/${sessionId}/video`,
            size_bytes: videoBuffer.byteLength,
          }), {
            status: 200,
            headers: corsHeaders({ "Content-Type": "application/json; charset=utf-8" }),
          });
        } catch (err) {
          return new Response(JSON.stringify({ error: `影片儲存失敗: ${err.message}` }), {
            status: 500,
            headers: corsHeaders({ "Content-Type": "application/json; charset=utf-8" }),
          });
        }
      }

      // 1.5 GET /api/session/:id/video - 影片 HTTP Range 串流與播放
      if (request.method === "GET" && action === "video") {
        let videoBuffer = null;

        if (r2) {
          const obj = await r2.get(`sessions/${sessionId}/video.mp4`, {
            range: request.headers,
            onlyIf: request.headers,
          });
          if (obj) {
            const resHeaders = new Headers();
            obj.writeHttpMetadata(resHeaders);
            resHeaders.set("etag", obj.httpEtag);
            corsHeaders().forEach?.((v, k) => resHeaders.set(k, v));
            resHeaders.set("Access-Control-Allow-Origin", "*");
            resHeaders.set("Accept-Ranges", "bytes");
            resHeaders.set("Content-Type", "video/mp4");
            const status = obj.range ? 206 : 200;
            return new Response(obj.body, { status, headers: resHeaders });
          }
        }

        if (kv) {
          videoBuffer = await kv.get(`session:${sessionId}:video`, { type: "arrayBuffer" });
        }

        if (!videoBuffer) {
          return new Response("Video not found or expired", {
            status: 404,
            headers: corsHeaders({ "Content-Type": "text/plain; charset=utf-8" }),
          });
        }

        const totalSize = videoBuffer.byteLength;
        const rangeHeader = request.headers.get("range");

        if (rangeHeader) {
          const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
          if (match) {
            const start = parseInt(match[1], 10);
            const end = match[2] ? parseInt(match[2], 10) : totalSize - 1;
            if (start < totalSize && end >= start) {
              const chunkSize = end - start + 1;
              const chunk = videoBuffer.slice(start, end + 1);
              return new Response(chunk, {
                status: 206,
                headers: corsHeaders({
                  "Content-Type": "video/mp4",
                  "Content-Range": `bytes ${start}-${end}/${totalSize}`,
                  "Accept-Ranges": "bytes",
                  "Content-Length": String(chunkSize),
                  "Cache-Control": "public, max-age=3600",
                }),
              });
            }
          }
        }

        return new Response(videoBuffer, {
          status: 200,
          headers: corsHeaders({
            "Content-Type": "video/mp4",
            "Accept-Ranges": "bytes",
            "Content-Length": String(totalSize),
            "Cache-Control": "public, max-age=3600",
          }),
        });
      }
    }

    // ==================== 1.6 Cross-Device Project Snapshot API (/api/project/:id) ====================
    if (url.pathname.startsWith("/api/project/")) {
      const parts = url.pathname.split("/").filter(Boolean); // ['api', 'project', ':projectId']
      const projectId = parts[2];
      if (!projectId) {
        return new Response(JSON.stringify({ error: "缺少 projectId" }), {
          status: 400,
          headers: corsHeaders({ "Content-Type": "application/json; charset=utf-8" }),
        });
      }

      const kv = env.FILM_CHAIN_KV;
      if (request.method === "POST" || request.method === "PUT") {
        try {
          const rawBody = await request.text();
          if (!rawBody) {
            throw new Error("專案內容為空");
          }
          // 驗證為合法 JSON
          JSON.parse(rawBody);
          if (kv) {
            await kv.put(`project:${projectId}`, rawBody, { expirationTtl: 86400 * 7 });
          }
          return new Response(JSON.stringify({ ok: true, project_id: projectId }), {
            status: 200,
            headers: corsHeaders({ "Content-Type": "application/json; charset=utf-8" }),
          });
        } catch (err) {
          return new Response(JSON.stringify({ error: `雲端專案儲存失敗: ${err.message}` }), {
            status: 400,
            headers: corsHeaders({ "Content-Type": "application/json; charset=utf-8" }),
          });
        }
      }

      if (request.method === "GET") {
        let rawProject = null;
        if (kv) {
          rawProject = await kv.get(`project:${projectId}`);
        }
        if (!rawProject) {
          return new Response(JSON.stringify({ error: "找不到該雲端專案快照或連結已過期" }), {
            status: 404,
            headers: corsHeaders({ "Content-Type": "application/json; charset=utf-8" }),
          });
        }
        return new Response(rawProject, {
          status: 200,
          headers: corsHeaders({ "Content-Type": "application/json; charset=utf-8" }),
        });
      }
    }

    // ==================== 2. CORS 反向代理端點 ====================
    if (url.pathname.startsWith("/api/proxy")) {
      let targetUrl = "";
      const pathSuffix = url.pathname.replace(/^\/api\/proxy/, "").replace(/^\/+/, "");

      // 支援專屬前綴路由: /api/proxy/fal/... 或 /api/proxy/minimax/...
      if (pathSuffix.startsWith("fal/")) {
        const subPath = pathSuffix.replace(/^fal\//, "");
        const base = subPath.startsWith("fal-ai/") || subPath.includes("/") ? "https://queue.fal.run" : "https://fal.run";
        targetUrl = `${base}/${subPath}${url.search}`;
      } else if (pathSuffix.startsWith("minimax/")) {
        const subPath = pathSuffix.replace(/^minimax\//, "");
        targetUrl = `https://api.minimax.chat/v1/${subPath}${url.search}`;
      } else {
        targetUrl = request.headers.get("X-Target-URL") || url.searchParams.get("target");
      }

      if (!targetUrl) {
        return new Response(JSON.stringify({ error: "缺少目標 URL (請帶上 X-Target-URL 標頭或 target 參數，或使用 /api/proxy/fal/... 與 /api/proxy/minimax/... 前綴路由)" }), {
          status: 400,
          headers: corsHeaders({ "Content-Type": "application/json; charset=utf-8" }),
        });
      }

      try {
        const forwardHeaders = new Headers();
        for (const [key, value] of request.headers.entries()) {
          const lower = key.toLowerCase();
          if (!["host", "cf-connecting-ip", "cf-ray", "cf-visitor", "x-target-url", "origin", "referer"].includes(lower)) {
            forwardHeaders.set(key, value);
          }
        }

        // 智慧映射 x-user-api-key 至上游標準授權標頭
        const userApiKey = request.headers.get("X-User-Api-Key");
        if (userApiKey && !forwardHeaders.has("authorization")) {
          if (targetUrl.includes("fal.run")) {
            forwardHeaders.set("Authorization", `Key ${userApiKey}`);
          } else {
            forwardHeaders.set("Authorization", `Bearer ${userApiKey}`);
          }
        }

        const isBodyAllowed = request.method !== "GET" && request.method !== "HEAD";
        const targetRes = await fetch(targetUrl, {
          method: request.method,
          headers: forwardHeaders,
          body: isBodyAllowed ? request.body : undefined,
        });

        const responseHeaders = new Headers(targetRes.headers);
        Object.entries(corsHeaders()).forEach(([k, v]) => responseHeaders.set(k, v));

        return new Response(targetRes.body, {
          status: targetRes.status,
          statusText: targetRes.statusText,
          headers: responseHeaders,
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: `代理發送失敗: ${err.message}` }), {
          status: 502,
          headers: corsHeaders({ "Content-Type": "application/json; charset=utf-8" }),
        });
      }
    }

    // ==================== 3. 靜態前端資源託管 ====================
    if (env && env.ASSETS && typeof env.ASSETS.fetch === "function") {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  },
};
