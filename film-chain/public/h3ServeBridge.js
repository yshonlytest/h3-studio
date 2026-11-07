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

  // 交給 AI Agent（本機 / 遠端虛擬機）代架環境時使用的引導 Prompt
  const AGENT_ONBOARDING_PROMPT = [
    '請在這台機器上替我架設 MiniMax-H3 本機渲染環境，完成後「帶我在網頁上操作產出自己的影片」，全程不要自行跑任何範例：',
    '',
    '【架設環境】',
    '1. git clone https://github.com/yshonlytest/h3-studio.git && cd h3-studio',
    '2. ./setup.sh（編譯 Apple Silicon Metal 引擎 engines/h3.c/h3）',
    '3. pip install -U "huggingface_hub[cli]" && huggingface-cli download MiniMax-AI/MiniMax-H3 --local-dir models/MiniMax-H3',
    '4. python3 -m pipeline.h3_server（守護進程監聽 127.0.0.1:8080）',
    '',
    '【環境就緒後：帶我操作網頁】',
    '- 引導我開啟網頁 https://film-chain.onlytest.dev/ ，選「路線 3：本機 Metal / ComfyUI」。',
    '- 陪我走完網頁五個步驟：步驟一讓我輸入「我自己的」故事大綱與主角參考圖 → 生成分鏡（潛空間一鏡到底或九宮格）→ 步驟三讓我按下「啟動本機渲染」→ 步驟四預覽成片。',
    '- 過程中協助我修改提示詞、運鏡與參數；影片渲染一律由本機 GPU 執行（零雲端費用）。',
    '',
    '【禁止事項】',
    '- 未經我明確說出「要跑範例」，不得執行 examples/storyboards/ 下任何示範 storyboard（如賽博偵探／仙俠 25 秒），以免白白浪費算力與點數。',
    '- 若你認為需要測試，必須先說明會消耗什麼資源並取得我的同意。',
    '',
    '【驗收標準】',
    '我的自訂故事在網頁上完成分鏡、由本機渲染並在步驟四播放成功，才算任務完成。'
  ].join('\n');

  // ==================== 狀態核心 H3LocalEnv（單一真相） ====================
  const envState = {
    daemon: 'checking',
    engine: 'none',
    hardware: { availableGiB: null },
    job: { running: false, currentSegment: 0, totalSegments: 0 }
  };
  const envListeners = new Set();

  function publishEnvState() {
    envListeners.forEach((fn) => {
      try { fn(H3LocalEnv.getState()); } catch (e) { console.warn('H3LocalEnv listener error:', e); }
    });
  }

  const H3LocalEnv = {
    getState() { return { ...envState, hardware: { ...envState.hardware }, job: { ...envState.job } }; },
    isDaemonOnline() { return envState.daemon === 'online'; },
    checkNow: null,
    startRender: null,
    subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      envListeners.add(fn);
      fn(H3LocalEnv.getState());
      return () => envListeners.delete(fn);
    }
  };
  window.H3LocalEnv = H3LocalEnv;

  function injectHudStyles() {
    if (document.getElementById('h3-hud-style')) return;
    const style = document.createElement('style');
    style.id = 'h3-hud-style';
    style.textContent = `
      @keyframes h3HudGlow {
        0%, 100% { box-shadow: 0 10px 30px rgba(0,0,0,0.5), 0 0 0 0 rgba(56,189,248,0.55); }
        50% { box-shadow: 0 10px 30px rgba(0,0,0,0.5), 0 0 0 9px rgba(56,189,248,0); }
      }
      .h3-hud-attention {
        border-color: #38bdf8 !important;
        animation: h3HudGlow 1.6s ease-out infinite;
      }
    `;
    document.head.appendChild(style);
  }

  function createHudElement() {
    if (document.getElementById('h3-daemon-hud')) return;
    injectHudStyles();

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
          <strong id="h3-hud-title" style="font-size: 13px;">本地環境中樞：偵測中...</strong>
        </div>
        <button id="h3-hud-toggle" style="background: none; border: none; color: #93a3bf; cursor: pointer; font-size: 12px;">▾</button>
      </div>
      <div id="h3-hud-body" style="display: flex; flex-direction: column; gap: 8px;">
        <div id="h3-hud-wizard" style="display: none; flex-direction: column; gap: 6px;">
          <div style="font-size: 11px; color: #93c5fd; line-height: 1.6;">
            🧙‍♂️ <strong>本地環境就緒精靈</strong>（僅限 Apple Silicon Mac）：依序 在終端機 執行以下指令，完成後點「重新檢測」：
          </div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="font-size: 11px; color: #93a3bf; flex: 1;">1️⃣ 取得專案</span>
            <button type="button" class="h3-hud-copy" data-cmd="git clone https://github.com/yshonlytest/h3-studio.git && cd h3-studio" style="background: #1e293b; color: #7dd3fc; border: 1px solid #334155; border-radius: 4px; padding: 2px 8px; font-size: 10px; cursor: pointer;">複製</button>
          </div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="font-size: 11px; color: #93a3bf; flex: 1;">2️⃣ 環境 Doctor（需 Xcode CLT + ffmpeg）</span>
            <button type="button" class="h3-hud-copy" data-cmd="./setup.sh" style="background: #1e293b; color: #7dd3fc; border: 1px solid #334155; border-radius: 4px; padding: 2px 8px; font-size: 10px; cursor: pointer;">複製</button>
          </div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="font-size: 11px; color: #93a3bf; flex: 1;">3️⃣ 下載模型權重（需已顯存足夠磁碟）</span>
            <button type="button" class="h3-hud-copy" data-cmd='pip install -U "huggingface_hub[cli]" && huggingface-cli download MiniMax-AI/MiniMax-H3 --local-dir models/MiniMax-H3' style="background: #1e293b; color: #7dd3fc; border: 1px solid #334155; border-radius: 4px; padding: 2px 8px; font-size: 10px; cursor: pointer;">複製</button>
          </div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="font-size: 11px; color: #93a3bf; flex: 1;">4️⃣ 啟動守護進程（Port 8080）</span>
            <button type="button" class="h3-hud-copy" data-cmd="python3 -m pipeline.h3_server" style="background: #1e293b; color: #7dd3fc; border: 1px solid #334155; border-radius: 4px; padding: 2px 8px; font-size: 10px; cursor: pointer;">複製</button>
          </div>
          <button type="button" class="h3-hud-copy h3-hud-copy-agent" data-source="agentPrompt" style="margin-top: 2px; background: rgba(245,158,11,0.18); color: #fcd34d; border: 1px solid #f59e0b; border-radius: 6px; padding: 5px 12px; font-size: 11px; font-weight: 600; cursor: pointer;">🤖 不想自己動手？複製引導 Prompt 交給 AI Agent（會帶你開網頁產出自己的影片）</button>
          <button id="h3-hud-redetect-btn" style="margin-top: 2px; background: rgba(56,189,248,0.2); color: #7dd3fc; border: 1px solid #38bdf8; border-radius: 6px; padding: 5px 12px; font-size: 11px; font-weight: 600; cursor: pointer;">🔄 重新檢測</button>
        </div>
        <div id="h3-hud-online-body" style="display: none; flex-direction: column; gap: 8px;">
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
            ">⚡ 開始本機渲染</button>
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
      </div>
    `;

    document.body.appendChild(hud);

    const toggleBtn = document.getElementById('h3-hud-toggle');
    const hudBody = document.getElementById('h3-hud-body');
    const hudHeader = hud.firstElementChild;
    hudHeader.style.cursor = 'pointer';
    let collapsed = true;
    function setCollapsed(state) {
      collapsed = state;
      hudBody.style.display = collapsed ? 'none' : 'flex';
      toggleBtn.textContent = collapsed ? '▴' : '▾';
      if (!collapsed) hud.classList.remove('h3-hud-attention');
    }
    setCollapsed(true);
    toggleBtn.addEventListener('click', (e) => { e.stopPropagation(); setCollapsed(!collapsed); });
    hudHeader.addEventListener('click', () => setCollapsed(!collapsed));

    // 環繞發光提醒：預設縮小時吸附注意力，使用者點開後自動解除
    function pingAttention() {
      if (collapsed) hud.classList.add('h3-hud-attention');
    }
    hud._pingAttention = pingAttention;
    window.H3LocalEnv.pingAttention = pingAttention;

    hud.querySelectorAll('.h3-hud-copy').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const text = btn.dataset.source === 'agentPrompt' ? AGENT_ONBOARDING_PROMPT : (btn.dataset.cmd || '');
        try {
          await navigator.clipboard.writeText(text);
          notifyUser('📋 已複製。貼給終端機執行，或貼給 AI Agent 照做');
        } catch (_e) {
          notifyUser('⚠️ 複製失敗，請手動輸入指令');
        }
      });
    });
    const redetectBtn = document.getElementById('h3-hud-redetect-btn');
    if (redetectBtn) redetectBtn.addEventListener('click', async () => {
      redetectBtn.textContent = '⏳ 檢測中...';
      redetectBtn.disabled = true;
      await checkDaemonStatus();
      redetectBtn.textContent = '🔄 重新檢測';
      redetectBtn.disabled = false;
    });

    document.getElementById('h3-hud-render-btn').addEventListener('click', async () => {
      if (typeof window.h3StudioStartLocalRender === 'function') {
        notifyUser('🚀 已呼叫工作坊主渲染流程（Metal → ComfyUI 自動備援）');
        await window.h3StudioStartLocalRender();
      } else {
        await handleStartRender();
      }
    });
    document.getElementById('h3-hud-lint-btn').addEventListener('click', handleCheckTension);
    document.getElementById('h3-hud-cancel-btn').addEventListener('click', handleCancelRender);
  }

  async function checkDaemonStatus() {
    createHudElement();
    const indicator = document.getElementById('h3-hud-indicator');
    const title = document.getElementById('h3-hud-title');
    const details = document.getElementById('h3-hud-details');
    const actions = document.getElementById('h3-hud-actions');
    const wizard = document.getElementById('h3-hud-wizard');
    const onlineBody = document.getElementById('h3-hud-online-body');

    try {
      const resp = await fetch(`${DAEMON_URL}/api/status`, { method: 'GET', mode: 'cors' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();

      isDaemonOnline = true;
      envState.daemon = 'online';
      envState.engine = data.engine === 'comfyui' ? 'comfyui' : 'metal';
      if (data.memory && Number.isFinite(data.memory.available_gib)) {
        envState.hardware.availableGiB = Number(data.memory.available_gib.toFixed(1));
      }
      if (data.job) {
        envState.job.running = !!data.job.running;
        envState.job.currentSegment = data.job.current_segment || 0;
        envState.job.totalSegments = data.job.total_segments || 0;
      }
      publishEnvState();

      indicator.style.background = '#10b981';
      title.textContent = '本地環境中樞：✅ 就緒 (H3 Metal)';
      const availRam = data.memory?.available_gib?.toFixed(1) || '?';
      details.innerHTML = `可用 RAM: <strong style="color: #10b981;">${availRam} GiB</strong> (零 FUSE 延遲已就緒)`;
      wizard.style.display = 'none';
      onlineBody.style.display = 'flex';
      actions.style.display = 'flex';

      if (data.job?.running) {
        showProgressView(true, `正在執行分鏡 ${data.job.current_segment}/${data.job.total_segments}...`, 50);
        subscribeToEvents();
      }
      return true;
    } catch (_) {
      isDaemonOnline = false;
      envState.daemon = 'offline';
      envState.engine = 'none';
      envState.hardware.availableGiB = null;
      envState.job = { running: false, currentSegment: 0, totalSegments: 0 };
      publishEnvState();

      indicator.style.background = '#64748b';
      title.textContent = '本地環境中樞：⚠️ 未就緒';
      details.textContent = '尚未偵測到本機守護進程，請依照就緒精靈完成安裝';
      wizard.style.display = 'flex';
      onlineBody.style.display = 'none';
      showProgressView(false);
      H3LocalEnv.pingAttention?.();
      return false;
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

  function notifyUser(msg) {
    if (typeof window.showToast === 'function') {
      window.showToast(msg);
    } else {
      console.warn(msg);
    }
  }

  async function handleStartRender() {
    if (!isDaemonOnline) return false;

    let manifestPayload = null;
    if (typeof window.exportChainedManifest === 'function') {
      try {
        manifestPayload = window.exportChainedManifest();
      } catch (err) {
        console.warn('exportChainedManifest failed:', err);
      }
    }

    if (!manifestPayload) {
      notifyUser("⚠️ 請先在步驟一或步驟二載入或生成分鏡腳本，再點擊啟動 Metal 渲染！");
      showProgressView(false);
      return false;
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
        notifyUser(`❌ 啟動渲染失敗: ${res.error || res.message}`);
        showProgressView(false);
        return false;
      }
      subscribeToEvents();
      return true;
    } catch (err) {
      notifyUser(`❌ 連線守護進程發生錯誤: ${err.message}`);
      showProgressView(false);
      return false;
    }
  }

  function subscribeToEvents() {
    if (activeEventSource) activeEventSource.close();

    activeEventSource = new EventSource(`${DAEMON_URL}/api/render/events`);

    activeEventSource.addEventListener('job_started', (e) => {
      const d = JSON.parse(e.data);
      envState.job.running = true;
      envState.job.currentSegment = 0;
      envState.job.totalSegments = d.total_segments || 0;
      publishEnvState();
      showProgressView(true, `開始渲染：${d.title} (共 ${d.total_segments} 鏡)`, 15);
    });

    activeEventSource.addEventListener('job_completed', (e) => {
      const d = JSON.parse(e.data);
      envState.job.running = false;
      publishEnvState();
      showProgressView(true, `✅ 渲染完成！耗時 ${d.duration_seconds} 秒`, 100);
      setTimeout(() => {
        showProgressView(false);
        checkDaemonStatus();
      }, 5000);
    });

    activeEventSource.addEventListener('job_error', (e) => {
      const d = JSON.parse(e.data);
      envState.job.running = false;
      publishEnvState();
      showProgressView(true, `❌ 渲染錯誤: ${d.error}`, 100);
    });

    activeEventSource.addEventListener('job_cancelled', () => {
      envState.job.running = false;
      publishEnvState();
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
      const msg = `🛡️ 動態張力評分: ${score}%（動作: ${data.actions} | 運鏡: ${data.cameras}）` +
                  (data.suggestions?.length ? ` · 建議: ${data.suggestions.join('; ')}` : ' · 動態張力飽滿！');
      notifyUser(msg);
    } catch (err) {
      notifyUser(`❌ Linter 連線失敗: ${err.message}`);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      H3LocalEnv.checkNow = checkDaemonStatus;
      H3LocalEnv.startRender = handleStartRender;
      checkDaemonStatus();
      setInterval(checkDaemonStatus, 15000);
    });
  } else {
    H3LocalEnv.checkNow = checkDaemonStatus;
    H3LocalEnv.startRender = handleStartRender;
    checkDaemonStatus();
    setInterval(checkDaemonStatus, 15000);
  }
})();
