import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../client/stores/createStore.ts";
import { coreStore } from "../client/stores/coreStore.ts";
import { storyboardStore } from "../client/stores/storyboardStore.ts";
import { computeStore } from "../client/stores/computeStore.ts";
import { audioSubtitleStore } from "../client/stores/audioSubtitleStore.ts";
import { normalizeComputeRoute } from "../client/features/uiShell.ts";

describe("Domain Stores - Core, Storyboard, Compute & AudioSubtitles", () => {
  beforeEach(() => {
    coreStore.reset();
    storyboardStore.reset();
    computeStore.reset();
    audioSubtitleStore.reset();
  });

  it("createStore supports getState, setState, select, subscribe, and reset", () => {
    const counter = createStore(() => ({ count: 0, label: "init" }));
    const seen: number[] = [];
    const unsubscribe = counter.subscribe((state) => {
      seen.push(state.count);
    });

    counter.setState({ count: 2 });
    counter.setState((prev) => ({ ...prev, count: prev.count + 3 }));
    assert.equal(counter.select((s) => s.count), 5);
    assert.deepEqual(seen, [2, 5]);

    unsubscribe();
    counter.reset();
    assert.deepEqual(counter.getState(), { count: 0, label: "init" });
    assert.deepEqual(seen, [2, 5]);
  });

  it("coreStore updates project mode, active project, and session state cleanly", () => {
    assert.equal(coreStore.getState().activeProjectMode, "creative");
    coreStore.setProjectMode("edu");
    coreStore.setActiveProject("proj_abc", "測試專案");
    coreStore.setSessionId("sess_123");

    const state = coreStore.getState();
    assert.equal(state.activeProjectMode, "edu");
    assert.equal(state.currentActiveProjectId, "proj_abc");
    assert.equal(state.currentActiveProjectName, "測試專案");
    assert.equal(state.currentSessionId, "sess_123");
  });

  it("storyboardStore isolates lexicon resets, enforces deepFreeze, and supports snapshot hydration", () => {
    const initialLex = storyboardStore.getState().activeLexiconData["zh-TW"] as Record<string, string>;
    assert.equal(initialLex["調用"], "吊用");
    assert.throws(() => {
      initialLex["測試詞"] = "測試音";
    }, TypeError);

    const checkLex = storyboardStore.getState().activeLexiconData["zh-TW"] as Record<string, string>;
    assert.equal(checkLex["測試詞"], undefined);

    storyboardStore.setPlan({
      project_slug: "test_slug",
      recommended_total_seconds: 10,
      reasoning_zh: "測試",
      expanded_story_zh: "故事",
      segments: [{ title: "Part 1", end_panel: 2, prompt: "Prompt 1" }],
    });
    storyboardStore.setRefImage("base64data", "image/png");
    storyboardStore.setEditingPanelIndex(4);

    const snapshot = storyboardStore.toSnapshot();
    storyboardStore.reset();
    assert.equal(storyboardStore.getState().currentPlan, null);

    storyboardStore.hydrate(snapshot);
    assert.equal(storyboardStore.getState().currentPlan?.project_slug, "test_slug");
    assert.equal(storyboardStore.getState().refImageBase64, "base64data");
    assert.equal(storyboardStore.getState().refImageMime, "image/png");
    assert.equal(storyboardStore.getState().currentEditingPanelIndex, 4);
  });

  it("computeStore tracks route, speed, playlist, and seamless playback state", () => {
    assert.equal(computeStore.getState().activeRoute, "colab");
    assert.equal(computeStore.getState().selectedSpeed, "quality");

    computeStore.setRoute("local");
    computeStore.setSpeed("fast");
    computeStore.setDetectedLocalEngine("h3_server");
    computeStore.setPlaylist([{ title: "Part 1", url: "assets/demo/p1.mp4" }]);
    computeStore.setSeamlessPlayback(true, 1);

    const state = computeStore.getState();
    assert.equal(state.activeRoute, "local");
    assert.equal(state.selectedSpeed, "fast");
    assert.equal(state.detectedLocalEngine, "h3_server");
    assert.equal(state.currentPlaylist.length, 1);
    assert.equal(state.isSeamlessPlaying, true);
    assert.equal(state.seamlessIndex, 1);
  });

  it("audioSubtitleStore manages dialogue items, BGM playback, and soft subtitles", () => {
    assert.equal(audioSubtitleStore.getState().softSubtitleEnabled, true);
    assert.equal(audioSubtitleStore.getState().isBgmPlaying, false);

    audioSubtitleStore.setDialogueItems([
      {
        partIndex: 0,
        partTitle: "Part 1",
        role: "旁白",
        text: "測試台詞",
        baseSec: 0,
        segDurationSec: 5,
        startOffsetSec: 0.5,
        durationSec: 3.0,
        userEdited: true,
        audioBlobUrl: null,
      },
    ]);
    audioSubtitleStore.setSoftSubtitleEnabled(false);
    audioSubtitleStore.setBgmPlaying(true);

    const state = audioSubtitleStore.getState();
    assert.equal(state.currentDialogueItems.length, 1);
    assert.equal(state.currentDialogueItems[0].text, "測試台詞");
    assert.equal(state.softSubtitleEnabled, false);
    assert.equal(state.isBgmPlaying, true);
  });

  it("deep-freezes currentPlan, prevents external mutations, and updates via immutable actions", () => {
    storyboardStore.setPlan({
      project_slug: "freeze_slug",
      recommended_total_seconds: 10,
      reasoning_zh: "初始推論",
      expanded_story_zh: "初始故事",
      segments: [
        { title: "Part 1", end_panel: 3, prompt: "Original prompt 1" },
        { title: "Part 2", end_panel: 9, prompt: "Original prompt 2" },
      ],
    });

    const frozenPlan = storyboardStore.getState().currentPlan!;
    assert.throws(() => {
      frozenPlan.segments[0].prompt = "mutated";
    }, TypeError);
    assert.throws(() => {
      frozenPlan.segments.push({ title: "Injected", end_panel: 5, prompt: "x" });
    }, TypeError);
    assert.equal(storyboardStore.getState().currentPlan?.segments[0].prompt, "Original prompt 1");
    assert.equal(storyboardStore.getState().currentPlan?.segments.length, 2);

    const notifiedPrompts: string[] = [];
    const unsubscribe = storyboardStore.subscribe((st) => {
      notifiedPrompts.push(st.currentPlan?.segments[0].prompt || "");
    });
    try {
      storyboardStore.updateSegmentAt(0, { prompt: "Updated via action", end_panel: 6 });
      assert.equal(storyboardStore.getState().currentPlan?.segments[0].prompt, "Updated via action");
      assert.equal(storyboardStore.getState().currentPlan?.segments[0].end_panel, 6);
      assert.deepEqual(notifiedPrompts, ["Updated via action"]);
      assert.throws(() => {
        storyboardStore.getState().currentPlan!.segments[0].prompt = "bypass";
      }, TypeError);

      storyboardStore.updatePlanMeta({ reasoning_zh: "新推論" });
      assert.equal(storyboardStore.getState().currentPlan?.reasoning_zh, "新推論");

      storyboardStore.updateSegments([
        { title: "Part 1 Replaced", end_panel: 4, prompt: "Replaced prompt" },
      ]);
      assert.equal(storyboardStore.getState().currentPlan?.segments.length, 1);
      assert.equal(storyboardStore.getState().currentPlan?.segments[0].title, "Part 1 Replaced");
    } finally {
      unsubscribe();
    }
  });

  it("rejects Map/Set/Date/RegExp/TypedArray/circular objects and allows declared opaqueKeys", () => {
    const testStore = createStore<{
      payload: unknown;
      handle: { close: () => void } | null;
    }>(() => ({ payload: null, handle: null }), {
      opaqueKeys: ["handle"],
    });

    assert.throws(() => testStore.setState({ payload: new Map([["a", 1]]) }), TypeError);
    assert.throws(() => testStore.setState({ payload: new Set([1, 2]) }), TypeError);
    assert.throws(() => testStore.setState({ payload: new Date() }), TypeError);
    assert.throws(() => testStore.setState({ payload: /abc/i }), TypeError);
    assert.throws(() => testStore.setState({ payload: new Uint8Array([1, 2, 3]) }), TypeError);

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    assert.throws(() => testStore.setState({ payload: circular }), TypeError);

    const runtimeHandle = { close: () => {} };
    testStore.setState({ handle: runtimeHandle });
    assert.equal(Object.isFrozen(testStore.getState().handle), false);
    assert.equal(testStore.getState().handle, runtimeHandle);
  });

  it("canonicalizes cloud route aliases to saas_api", () => {
    assert.equal(normalizeComputeRoute("cloud"), "saas_api");
    assert.equal(normalizeComputeRoute("saas_api"), "saas_api");
    assert.equal(normalizeComputeRoute("local"), "local");
    assert.equal(normalizeComputeRoute("unknown"), "colab");

    computeStore.setRoute("saas_api");
    assert.equal(computeStore.getState().activeRoute, "saas_api");
  });
});
