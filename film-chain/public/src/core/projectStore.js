/**
 * H3 Storyboard Studio - projectStore.js
 * 多專案自動存檔 (IndexedDB)、專案打包匯出/匯入 (.filmchain.json)、雲端跨裝置快照同步與九宮格單格精修縫合邏輯
 */
(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    root.H3ProjectStore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const BUNDLE_MAGIC = 'FILMCHAIN_PROJECT_V1';
  const BUNDLE_VERSION = '1.0.0';
  const DB_NAME = 'FilmChainWorkspaceDB';
  const DB_VERSION = 1;
  const STORE_PROJECTS = 'projects';
  const STORE_META = 'meta';

  // Node.js / 無 IndexedDB 環境的記憶體備援儲存
  const memoryProjects = new Map();
  const memoryMeta = new Map();

  /**
   * 產生唯一專案 ID
   * @returns {string}
   */
  function generateProjectId() {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 7);
    return `fc_${ts}_${rand}`;
  }

  /**
   * 建立乾淨的空白專案結構
   * @param {Object} [opts]
   * @param {string} [opts.id]
   * @param {string} [opts.name]
   * @returns {Object}
   */
  function createEmptyProject(opts = {}) {
    const id = opts.id || generateProjectId();
    const name = (opts.name || '新分鏡創作專案').trim();
    return {
      id,
      name,
      updatedAt: Date.now(),
      isDemo: Boolean(opts.isDemo),
      chineseDesc: '',
      speedMode: 'quality',
      activeRoute: 'colab',
      refImageDataUrl: '',
      refImageMime: 'image/jpeg',
      gridImageDataUrl: '',
      slicedPanelsDataUrls: {},
      plan: {
        project_slug: 'custom_story',
        grid_image_name: 'storyboard_9grid.png',
        recommended_total_seconds: 15,
        reasoning_zh: '可於步驟一輸入中文故事並點擊「AI 產生分鏡計畫」，或直接手動編輯以下分段提示詞。',
        expanded_story_zh: '',
        segments: [
          { title: 'Part 1 (0-5s): 開場建立鏡頭', end_panel: 3, prompt: '' },
          { title: 'Part 2 (5-10s): 核心動作推展', end_panel: 6, prompt: '' },
          { title: 'Part 3 (10-15s): 轉折與收尾鏡頭', end_panel: 9, prompt: '' }
        ]
      },
      playlist: [],
      mergedVideoUrl: '',
      segmentHistory: {},
      activeVersionIndex: {},
      dialogueItems: [],
      bgmStyle: 'fantasy',
      bgmVolume: 35,
      audioDucking: true,
      softSubtitle: true,
      burnInSubtitle: false
    };
  }

  /**
   * 將專案物件序列化為可匯出下載的 .filmchain.json 字串
   * @param {Object} project
   * @returns {string}
   */
  function serializeProjectBundle(project) {
    if (!project || typeof project !== 'object') {
      throw new Error('無效的專案資料，無法打包匯出');
    }
    const bundle = {
      magic: BUNDLE_MAGIC,
      version: BUNDLE_VERSION,
      exportedAt: new Date().toISOString(),
      project: {
        ...project,
        updatedAt: project.updatedAt || Date.now()
      }
    };
    return JSON.stringify(bundle, null, 2);
  }

  /**
   * 解析並驗證匯入的 .filmchain.json 字串
   * @param {string} jsonString
   * @returns {Object} 還原後的 project 物件
   */
  function parseAndValidateBundle(jsonString) {
    if (!jsonString || typeof jsonString !== 'string') {
      throw new Error('匯入內容為空或格式不正確');
    }
    let parsed;
    try {
      parsed = JSON.parse(jsonString);
    } catch (err) {
      throw new Error('JSON 解析失敗：請確認檔案為有效的 .filmchain.json 專案檔');
    }

    // 相容完整封裝格式或直接傳入含 plan 的專案物件
    const proj = (parsed && parsed.magic === BUNDLE_MAGIC && parsed.project)
      ? parsed.project
      : (parsed && parsed.plan && Array.isArray(parsed.plan.segments) ? parsed : null);

    if (!proj || !proj.plan || !Array.isArray(proj.plan.segments)) {
      throw new Error('專案檔結構不完整：缺少有效的分鏡計畫 (plan.segments)');
    }

    const base = createEmptyProject({
      id: proj.id || generateProjectId(),
      name: proj.name || proj.plan.project_slug || '匯入的分鏡專案'
    });

    return {
      ...base,
      ...proj,
      id: proj.id || base.id,
      name: (proj.name || base.name).trim(),
      updatedAt: Date.now()
    };
  }

  // ==================== IndexedDB 儲存引擎 ====================
  function openDatabase() {
    if (typeof indexedDB === 'undefined') {
      return Promise.resolve(null);
    }
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
          db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'key' });
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error || new Error('IndexedDB 開啟失敗'));
    });
  }

  /**
   * 儲存專案至本機 IndexedDB (並自動設為最後活躍專案)
   * @param {Object} project
   * @returns {Promise<Object>}
   */
  async function saveProject(project) {
    if (!project || !project.id) {
      throw new Error('專案缺少有效 id');
    }
    const record = {
      ...project,
      updatedAt: Date.now()
    };

    const db = await openDatabase();
    if (!db) {
      memoryProjects.set(record.id, JSON.parse(JSON.stringify(record)));
      memoryMeta.set('lastActiveProjectId', record.id);
      return record;
    }

    await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_PROJECTS, STORE_META], 'readwrite');
      tx.objectStore(STORE_PROJECTS).put(record);
      tx.objectStore(STORE_META).put({ key: 'lastActiveProjectId', value: record.id });
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error || new Error('IndexedDB 寫入失敗'));
    });

    return record;
  }

  /**
   * 依 ID 讀取專案
   * @param {string} id
   * @returns {Promise<Object|null>}
   */
  async function getProject(id) {
    if (!id) return null;
    const db = await openDatabase();
    if (!db) {
      const item = memoryProjects.get(id);
      return item ? JSON.parse(JSON.stringify(item)) : null;
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_PROJECTS], 'readonly');
      const req = tx.objectStore(STORE_PROJECTS).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * 列出所有已保存的專案 (依 updatedAt 由新到舊排序)
   * @returns {Promise<Array<Object>>}
   */
  async function listProjects() {
    const db = await openDatabase();
    let list = [];
    if (!db) {
      list = Array.from(memoryProjects.values()).map(x => JSON.parse(JSON.stringify(x)));
    } else {
      list = await new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_PROJECTS], 'readonly');
        const req = tx.objectStore(STORE_PROJECTS).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = (e) => reject(e.target.error);
      });
    }
    return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  /**
   * 刪除指定專案
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async function deleteProject(id) {
    if (!id) return false;
    const db = await openDatabase();
    if (!db) {
      const existed = memoryProjects.delete(id);
      if (memoryMeta.get('lastActiveProjectId') === id) {
        const remaining = await listProjects();
        memoryMeta.set('lastActiveProjectId', remaining[0]?.id || null);
      }
      return existed;
    }

    await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_PROJECTS], 'readwrite');
      tx.objectStore(STORE_PROJECTS).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
    return true;
  }

  /**
   * 取得最後一次編輯的活躍專案 ID
   * @returns {Promise<string|null>}
   */
  async function getLastActiveProjectId() {
    const db = await openDatabase();
    if (!db) {
      return memoryMeta.get('lastActiveProjectId') || null;
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_META], 'readonly');
      const req = tx.objectStore(STORE_META).get('lastActiveProjectId');
      req.onsuccess = () => resolve(req.result ? req.result.value : null);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * 設定最後一次編輯的活躍專案 ID
   * @param {string} id
   * @returns {Promise<void>}
   */
  async function setLastActiveProjectId(id) {
    const db = await openDatabase();
    if (!db) {
      memoryMeta.set('lastActiveProjectId', id);
      return;
    }
    await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_META], 'readwrite');
      tx.objectStore(STORE_META).put({ key: 'lastActiveProjectId', value: id });
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * 清空記憶體備援庫 (供單元測試重置使用)
   */
  function _clearMemoryStoreForTests() {
    memoryProjects.clear();
    memoryMeta.clear();
  }

  // ==================== 雲端跨裝置快照同步 ====================
  /**
   * 將專案快照上傳至 Cloudflare Worker KV，供手機/電腦跨裝置開啟
   * @param {Object} project
   * @param {string} [baseUrl='']
   * @returns {Promise<{ ok: boolean, projectId: string, shareUrl: string }>}
   */
  async function syncProjectToCloud(project, baseUrl = '') {
    if (!project || !project.id) {
      throw new Error('缺少專案資料，無法同步至雲端');
    }
    const cleanBase = baseUrl ? baseUrl.replace(/\/+$/, '') : '';
    const url = `${cleanBase}/api/project/${encodeURIComponent(project.id)}`;

    // 為避免超過 KV 25MB 限制，傳送劇本、九宮格圖、參考圖與設定 (排除本機暫存 blob:// 影片網址)
    const cloudPayload = {
      ...project,
      playlist: (project.playlist || []).filter(item => item && item.url && !String(item.url).startsWith('blob:')),
      mergedVideoUrl: (project.mergedVideoUrl && !String(project.mergedVideoUrl).startsWith('blob:'))
        ? project.mergedVideoUrl
        : ''
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: serializeProjectBundle(cloudPayload)
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `雲端同步失敗 (${res.status})`);
    }

    const origin = (typeof window !== 'undefined' && window.location && window.location.origin)
      ? window.location.origin
      : (cleanBase || 'https://film-chain.onlytest.dev');
    const shareUrl = `${origin}/?project=${encodeURIComponent(project.id)}`;

    return {
      ok: true,
      projectId: project.id,
      shareUrl
    };
  }

  /**
   * 從 Cloudflare Worker KV 拉取跨裝置專案快照
   * @param {string} projectId
   * @param {string} [baseUrl='']
   * @returns {Promise<Object>}
   */
  async function fetchProjectFromCloud(projectId, baseUrl = '') {
    if (!projectId) {
      throw new Error('缺少雲端專案 ID');
    }
    const cleanBase = baseUrl ? baseUrl.replace(/\/+$/, '') : '';
    const url = `${cleanBase}/api/project/${encodeURIComponent(projectId)}`;

    const res = await fetch(url);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `找不到該雲端專案或已過期 (${res.status})`);
    }

    const text = await res.text();
    return parseAndValidateBundle(text);
  }

  // ==================== 九宮格單格局部精修與重新縫合 ====================
  /**
   * 建構針對九宮格單一格 (Panel 1~9) 的 AI 局部重繪提示詞
   * @param {Object} opts
   * @param {number} opts.panelIndex - 1 ~ 9
   * @param {string} [opts.storyDesc] - 整體故事描述
   * @param {string} [opts.segmentPrompt] - 對應鏡段的英文或中文提示詞
   * @param {string} [opts.customInstruction] - 使用者針對該格的具體修改指示
   * @returns {string}
   */
  function buildSinglePanelPrompt({ panelIndex, storyDesc = '', segmentPrompt = '', customInstruction = '' }) {
    const idx = Math.max(1, Math.min(9, parseInt(panelIndex, 10) || 1));
    const userNote = customInstruction && customInstruction.trim()
      ? `Specific refinement for this single frame: ${customInstruction.trim()}.`
      : '';
    const segContext = segmentPrompt && segmentPrompt.trim()
      ? `Scene context: ${segmentPrompt.trim()}.`
      : '';
    const storyContext = storyDesc && storyDesc.trim()
      ? `Overall story: ${storyDesc.trim()}.`
      : '';

    return [
      `Create a SINGLE full-bleed cinematic film frame for Panel #${idx} of our storyboard.`,
      `Keep the exact same character identity, costume, material texture, and lighting environment as the reference image.`,
      storyContext,
      segContext,
      userNote,
      `IMPORTANT: Output ONLY ONE single continuous scene image (NOT a grid, NO split screens, NO borders, NO panel numbers, NO captions or text).`
    ].filter(Boolean).join(' ');
  }

  /**
   * 將 9 張單格圖片 (slicedPanelsDataUrls[1..9]) 重新無縫縫合為一張 3x3 九宮格母圖 DataURL
   * @param {Object} panelsMap - { 1: dataUrl, 2: dataUrl, ..., 9: dataUrl }
   * @param {number} [cellWidth=640]
   * @param {number} [cellHeight=480]
   * @returns {Promise<string>} 縫合後的 3x3 PNG DataURL
   */
  async function stitchPanelsToGridDataUrl(panelsMap, cellWidth = 640, cellHeight = 480) {
    if (!panelsMap || typeof panelsMap !== 'object') {
      throw new Error('缺少九宮格單格圖檔資料');
    }
    if (typeof document === 'undefined') {
      // Node.js 測試環境回傳模擬標記
      return 'data:image/png;base64,STITCHED_GRID_MOCK';
    }

    const canvas = document.createElement('canvas');
    canvas.width = cellWidth * 3;
    canvas.height = cellHeight * 3;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const loadImg = (src) => new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('載入單格圖片失敗'));
      img.src = src;
    });

    for (let idx = 1; idx <= 9; idx++) {
      const src = panelsMap[idx];
      if (!src) continue;
      const row = Math.floor((idx - 1) / 3);
      const col = (idx - 1) % 3;
      const img = await loadImg(src);
      ctx.drawImage(img, col * cellWidth, row * cellHeight, cellWidth, cellHeight);
    }

    return canvas.toDataURL('image/png');
  }

  return {
    BUNDLE_MAGIC,
    BUNDLE_VERSION,
    generateProjectId,
    createEmptyProject,
    serializeProjectBundle,
    parseAndValidateBundle,
    saveProject,
    getProject,
    listProjects,
    deleteProject,
    getLastActiveProjectId,
    setLastActiveProjectId,
    syncProjectToCloud,
    fetchProjectFromCloud,
    buildSinglePanelPrompt,
    stitchPanelsToGridDataUrl,
    _clearMemoryStoreForTests
  };
});
