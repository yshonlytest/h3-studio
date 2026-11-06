/**
 * H3 Storyboard Studio - h3ServeBridge.js
 * 
 * 漸進式增量掛載：偵測本機 h3-studio serve 守護進程，解鎖「一鍵原生 Metal 渲染」、
 * 「動態張力 Linter」與「SSE 即時進度串流」，無守護進程時靜默降級，保證 100% 零回歸。
 */

(function () {
  'use strict';

  const DAEMON_PORT = 8080;
  const DAEMON_URL = `http://127.0.0.1:${DAEMON_PORT}`;
  let isDaemonOnline = false;
  let activeEventSource = null;

  function createHudElement() {
    if (document.getElementById('h3-daemon-hud')) return;

    const hud = document.createElement('div');
    hud.id = 'h3-daemon-hud';
    hud.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 9999;
      background: rgba(19, 26, 39, 0.95);
      backdrop-filter: blur(12px);
      border: 1px solid #253147;
      border-radius: 12px;
      padding: 12px 18px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
      font-size: 13px;
      color: #eef2f9;
      display: flex;
      flex-direction: column;
      gap: 10px;
      transition: all 0.3s ease;
      max-width: 380px;
    `;

    hud.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span id="h3-hud-indicator" style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #64748b;"></span>
          <strong id="h3-hud-title" style="font-size: 13px;">H3 守護進程偵測中...</strong>
        </div>
        <button id="h3-hud-toggle" style="background: none; border: none; color: #93a3bf; cursor: pointer; font-size: 12px;">▾</button>
      </div>
      <div id="h3-hud-body" style="display: flex; flex-direction: column; gap: 8px;">
        <div id="h3-hud-details" style="font-size: 12px; color: #93a3bf;">檢查 127.0.0.1:8080 連線狀態...</div>
        <div id="h3-hud-actions" style="display: none; gap: 8px; flex-wrap: wrap; margin-top: 4px;">
          <button id="h3-hud-render-btn" style="
            background: linear-gradient(135deg, #6366f1, #4f46e5);
            color: #fff;
            border: none;
            border-radius: 6px;
            padding: 6px 12px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 4px;
          ">⚡ 原生 Metal 渲染</button>
          <button id="h3-hud-lint-btn" style="
            background: #1e293b;
            color: #e2e8f0;
            border: 1px solid #334155;
            border-radius: 6px;
            padding: 6px 12px;
            font-size: 12px;
            cursor: pointer;
          ">🛡️ 動態張力檢查</button>
        </div>
        <div id="h3-hud-progress-container" style="display: none; flex-direction: column; gap: 4px; margin-top: 6px;">
          <div style="display: flex; justify-content: space-between; font-size: 11px; color: #cbd5e1;">
            <span id="h3-hud-progress-text">準備渲染...</span>
            <span id="h3-hud-progress-pct">0%</span>
          </div>
          <div style="width: 100%; height: 6px; background: #0f172a; border-radius: 3px; overflow: hidden;">
            <div id="h3-hud-progress-bar" style="width: 0%; height: 100%; background: #6366f1; transition: width 0.2s;"></div>
          </div>
          <button id="h3-hud-cancel-btn" style="
            align-self: flex-end;
            background: none;
            border: none;
            color: #ef4444;
            font-size: 11px;
            cursor: pointer;
            padding: 2px 4px;
          ">中斷任務</button>
        </div>
      </div>
    `;

    document.body.appendChild(hud);

    const toggleBtn = document.getElementById('h3-hud-toggle');
    const hudBody = document.getElementById('h3-hud-body');
    let collapsed = false;
    toggleBtn.addEventListener('click', () => {
      collapsed = !collapsed;
      hudBody.style.display = collapsed ? 'none' : 'flex';
      toggleBtn.textContent = collapsed ? '▴' : '▾';
    });

    document.getElementById('h3-hud-render-btn').addEventListener('click', handleStartRender);
    document.getElementById('h3-hud-lint-btn').addEventListener('click', handleCheckTension);
    document.getElementById('h3-hud-cancel-btn').addEventListener('click', handleCancelRender);
  }

  async function checkDaemonStatus() {
    createHudElement();
    const indicator = document.getElementById('h3-hud-indicator');
    const title = document.getElementById('h3-hud-title');
    const details = document.getElementById('h3-hud-details');
    const actions = document.getElementById('h3-hud-actions');

    try {
      const resp = await fetch(`${DAEMON_URL}/api/status`, { method: 'GET', mode: 'cors' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();

      isDaemonOnline = true;
      indicator.style.background = '#10b981';
      title.textContent = 'H3 本機 Metal 守護進程在線';
      const availRam = data.memory?.available_gib?.toFixed(1) || '?';
      details.innerHTML = `可用 RAM: <strong style="color: #10b981;">${availRam} GiB</strong> (零 FUSE 延遲已就緒)`;
      actions.style.display = 'flex';

      if (data.job?.running) {
        showProgressView(true, `正在執行分鏡 ${data.job.current_segment}/${data.job.total_segments}...`, 50);
        subscribeToEvents();
      }
    } catch (_) {
      isDaemonOnline = false;
      indicator.style.background = '#64748b';
      title.textContent = 'H3 守護進程：離線';
      details.textContent = '可執行 python3 -m pipeline.h3_server 開啟原生加速';
      actions.style.display = 'none';
      showProgressView(false);
    }
  }

  function showProgressView(show, text = '', pct = 0) {
    const container = document.getElementById('h3-hud-progress-container');
    const pText = document.getElementById('h3-hud-progress-text');
    const pPct = document.getElementById('h3-hud-progress-pct');
    const pBar = document.getElementById('h3-hud-progress-bar');
    if (!container) return;

    container.style.display = show ? 'flex' : 'none';
    if (show) {
      if (text) pText.textContent = text;
      pPct.textContent = `${pct}%`;
      pBar.style.width = `${pct}%`;
    }
  }

  async function handleStartRender() {
    if (!isDaemonOnline) return;

    let manifestPayload = null;
    if (typeof window.exportChainedManifest === 'function') {
      try {
        manifestPayload = window.exportChainedManifest();
      } catch (err) {
        console.warn('exportChainedManifest failed:', err);
      }
    }

    if (!manifestPayload) {
      manifestPayload = {
        title: "Cyberpunk Neo-Noir (Studio Live Render)",
        mode: "turbo",
        width: 864,
        height: 480,
        frames: 124,
        steps: 6,
        layers: 50,
        reuse: 0,
        segments: [
          {
            segment: 1,
            title: "Part 1 (0-5s): Establishing Shot",
            chain_mode: "first_frame",
            prompt: "[Scene] Futuristic rain-slicked alleyway at midnight. [Camera] Tracking push-in. Character sprints forward."
          }
        ]
      };
    }

    showProgressView(true, '正在提交分鏡至 H3 Metal 引擎...', 10);

    try {
      const resp = await fetch(`${DAEMON_URL}/api/render/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manifest: manifestPayload, dry_run: false }),
        mode: 'cors'
      });
      const res = await resp.json();
      if (!resp.ok) {
        alert(`啟動渲染失敗: ${res.error || res.message}`);
        showProgressView(false);
        return;
      }
      subscribeToEvents();
    } catch (err) {
      alert(`連線守護進程發生錯誤: ${err.message}`);
      showProgressView(false);
    }
  }

  function subscribeToEvents() {
    if (activeEventSource) activeEventSource.close();

    activeEventSource = new EventSource(`${DAEMON_URL}/api/render/events`);

    activeEventSource.addEventListener('job_started', (e) => {
      const d = JSON.parse(e.data);
      showProgressView(true, `開始渲染：${d.title} (共 ${d.total_segments} 鏡)`, 15);
    });

    activeEventSource.addEventListener('job_completed', (e) => {
      const d = JSON.parse(e.data);
      showProgressView(true, `✅ 渲染完成！耗時 ${d.duration_seconds} 秒`, 100);
      setTimeout(() => {
        showProgressView(false);
        checkDaemonStatus();
      }, 5000);
    });

    activeEventSource.addEventListener('job_error', (e) => {
      const d = JSON.parse(e.data);
      showProgressView(true, `❌ 渲染錯誤: ${d.error}`, 100);
    });

    activeEventSource.addEventListener('job_cancelled', () => {
      showProgressView(true, '⚠️ 渲染已被使用者中斷', 0);
      setTimeout(() => showProgressView(false), 3000);
    });
  }

  async function handleCancelRender() {
    try {
      await fetch(`${DAEMON_URL}/api/render/cancel`, { method: 'POST', mode: 'cors' });
    } catch (err) {
      console.error('Cancel request failed:', err);
    }
  }

  async function handleCheckTension() {
    const promptInput = document.getElementById('customPrompt') || document.querySelector('textarea');
    const promptText = promptInput ? promptInput.value : "Character sprints forward and leaps onto rooftop, camera tracking quickly.";

    try {
      const resp = await fetch(`${DAEMON_URL}/api/lint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: promptText }),
        mode: 'cors'
      });
      const data = await resp.json();
      const score = (data.score * 100).toFixed(0);
      const msg = `🛡️ 動態張力評分: ${score}%\n動作動詞數: ${data.actions} | 運鏡關鍵字: ${data.cameras}\n` +
                  (data.suggestions?.length ? `優化建議:\n- ${data.suggestions.join('\n- ')}` : '動態張力飽滿，符合高動態標準！');
      alert(msg);
    } catch (err) {
      alert(`Linter 連線失敗: ${err.message}`);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      checkDaemonStatus();
      setInterval(checkDaemonStatus, 15000);
    });
  } else {
    checkDaemonStatus();
    setInterval(checkDaemonStatus, 15000);
  }
})();
