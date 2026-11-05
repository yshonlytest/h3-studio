const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const projectStore = require('../public/src/core/projectStore.js');

describe('H3 Storyboard Studio - Project Workspace & Persistence Tests', () => {
  beforeEach(() => {
    projectStore._clearMemoryStoreForTests();
  });

  // ==================== 1. Project Creation & Bundle Serialization ====================
  describe('createEmptyProject & Bundle Serialization', () => {
    it('should create a clean default project structure with 3 segments', () => {
      const proj = projectStore.createEmptyProject({ name: '我的武俠短片' });
      assert.ok(proj.id.startsWith('fc_'));
      assert.equal(proj.name, '我的武俠短片');
      assert.equal(proj.plan.segments.length, 3);
      assert.equal(proj.plan.segments[2].end_panel, 9);
    });

    it('should serialize and restore a .filmchain.json bundle losslessly', () => {
      const proj = projectStore.createEmptyProject({ id: 'fc_test_1', name: '沖繩石獅傳奇' });
      proj.chineseDesc = '石獅子甦醒並拋接發光球';
      proj.gridImageDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

      const jsonStr = projectStore.serializeProjectBundle(proj);
      const parsed = JSON.parse(jsonStr);
      assert.equal(parsed.magic, projectStore.BUNDLE_MAGIC);
      assert.equal(parsed.version, projectStore.BUNDLE_VERSION);

      const restored = projectStore.parseAndValidateBundle(jsonStr);
      assert.equal(restored.id, 'fc_test_1');
      assert.equal(restored.name, '沖繩石獅傳奇');
      assert.equal(restored.chineseDesc, '石獅子甦醒並拋接發光球');
      assert.equal(restored.gridImageDataUrl, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==');
    });

    it('should reject invalid or corrupted JSON bundles', () => {
      assert.throws(() => {
        projectStore.parseAndValidateBundle('not-valid-json');
      }, /JSON 解析失敗/);

      assert.throws(() => {
        projectStore.parseAndValidateBundle(JSON.stringify({ hello: 'world' }));
      }, /專案檔結構不完整/);
    });
  });

  // ==================== 2. Multi-Project CRUD & Active Project Tracking ====================
  describe('IndexedDB / Memory CRUD & Active Workspace', () => {
    it('should save, retrieve, list, and track last active project', async () => {
      const p1 = projectStore.createEmptyProject({ id: 'fc_p1', name: '專案一號' });
      const p2 = projectStore.createEmptyProject({ id: 'fc_p2', name: '專案二號' });

      await projectStore.saveProject(p1);
      // Wait 5ms so updatedAt differs
      await new Promise(r => setTimeout(r, 5));
      await projectStore.saveProject(p2);

      const activeId = await projectStore.getLastActiveProjectId();
      assert.equal(activeId, 'fc_p2');

      const list = await projectStore.listProjects();
      assert.equal(list.length, 2);
      assert.equal(list[0].id, 'fc_p2');
      assert.equal(list[1].id, 'fc_p1');

      const loadedP1 = await projectStore.getProject('fc_p1');
      assert.equal(loadedP1.name, '專案一號');

      await projectStore.deleteProject('fc_p2');
      const remaining = await projectStore.listProjects();
      assert.equal(remaining.length, 1);
      assert.equal(remaining[0].id, 'fc_p1');
    });
  });

  // ==================== 3. Cloud Cross-Device Sync ====================
  describe('Cloud Snapshot Sync', () => {
    it('should sync project to cloud and fetch it back via /api/project/:id', async () => {
      const originalFetch = globalThis.fetch;
      let storedBundle = '';

      try {
        globalThis.fetch = async (url, opts = {}) => {
          if (opts.method === 'POST') {
            storedBundle = opts.body;
            return new Response(JSON.stringify({ ok: true, project_id: 'fc_cloud_99' }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          }
          return new Response(storedBundle, {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        };

        const proj = projectStore.createEmptyProject({ id: 'fc_cloud_99', name: '跨裝置測試專案' });
        proj.chineseDesc = '在電腦編輯，用手機接力觀看';
        proj.mergedVideoUrl = 'blob:https://film-chain.onlytest.dev/12345'; // blob URLs should be stripped for cloud

        const syncRes = await projectStore.syncProjectToCloud(proj, 'https://film-chain.onlytest.dev');
        assert.equal(syncRes.ok, true);
        assert.equal(syncRes.projectId, 'fc_cloud_99');
        assert.match(syncRes.shareUrl, /\?project=fc_cloud_99$/);

        const fetched = await projectStore.fetchProjectFromCloud('fc_cloud_99', 'https://film-chain.onlytest.dev');
        assert.equal(fetched.name, '跨裝置測試專案');
        assert.equal(fetched.chineseDesc, '在電腦編輯，用手機接力觀看');
        assert.equal(fetched.mergedVideoUrl, ''); // blob stripped safely
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  // ==================== 4. Single-Panel Prompt & Grid Stitcher ====================
  describe('Single-Panel Refiner Helpers', () => {
    it('should build targeted single-panel regeneration prompt without grid artifacts', () => {
      const prompt = projectStore.buildSinglePanelPrompt({
        panelIndex: 5,
        storyDesc: '沖繩風獅爺在傍晚甦醒',
        segmentPrompt: 'Shisa tosses 5 glowing balls in the air',
        customInstruction: '讓發光的球更亮、表情更開心'
      });

      assert.match(prompt, /Panel #5/);
      assert.match(prompt, /讓發光的球更亮、表情更開心/);
      assert.match(prompt, /NOT a grid, NO split screens/);
    });
  });
});
