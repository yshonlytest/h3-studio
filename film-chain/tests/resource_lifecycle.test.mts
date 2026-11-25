import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  initStagingTrack,
  type StagingCanvasElement,
} from "../client/features/stagingCanvas.ts";
import { playCompletionChime } from "../client/features/uiShell.ts";
import { handleCustomBgmUpload } from "../client/features/audioSubtitles.ts";
import { audioSubtitleStore } from "../client/stores/audioSubtitleStore.ts";

type ListenerFn = (evt: Record<string, unknown>) => void;

function createEventRegistry() {
  const map = new Map<string, Set<ListenerFn>>();
  return {
    addEventListener(type: string, fn: ListenerFn): void {
      if (!map.has(type)) map.set(type, new Set());
      map.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: ListenerFn): void {
      map.get(type)?.delete(fn);
    },
    emit(type: string, evt: Record<string, unknown>): void {
      for (const fn of Array.from(map.get(type) || [])) {
        fn(evt);
      }
    },
    count(type: string): number {
      return map.get(type)?.size || 0;
    },
    totalCount(types: string[]): number {
      return types.reduce((acc, t) => acc + (map.get(t)?.size || 0), 0);
    },
  };
}

describe("A4-5 Resource Lifecycle - Staging Drag Listeners & AudioContext Cleanup", () => {
  it("stagingCanvas attaches window drag listeners only during active mouse/touch drag and detaches on end", () => {
    const g = globalThis as Record<string, unknown>;
    const hadWindow = Object.prototype.hasOwnProperty.call(g, "window");
    const prevWindow = g.window;

    const winReg = createEventRegistry();
    const canvasReg = createEventRegistry();
    g.window = {
      addEventListener: winReg.addEventListener,
      removeEventListener: winReg.removeEventListener,
    };

    const noopCtx = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "canvas") return undefined;
          return () => {};
        },
      }
    );

    const fakeCanvas = {
      width: 280,
      height: 160,
      style: { cursor: "" },
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
      getContext: () => noopCtx,
      closest: () => null,
      addEventListener: canvasReg.addEventListener,
      removeEventListener: canvasReg.removeEventListener,
    } as unknown as StagingCanvasElement;

    const dragEventTypes = ["mousemove", "mouseup", "touchmove", "touchend", "touchcancel"];

    try {
      initStagingTrack(fakeCanvas);
      assert.equal(winReg.totalCount(dragEventTypes), 0, "Window must have zero drag listeners at rest");

      // Subject defaults to (0.0, -0.2) -> px (140, 69)
      canvasReg.emit("mousedown", { clientX: 140, clientY: 69 });
      assert.ok(winReg.count("mousemove") === 1 && winReg.count("mouseup") === 1, "Mouse drag attaches window listeners");

      winReg.emit("mousemove", {
        clientX: 198,
        clientY: 80,
        preventDefault() {},
      });
      assert.ok(fakeCanvas._track!.subject.x > 0.9, "Dragging updates subject x coordinate");

      winReg.emit("mouseup", {});
      assert.equal(winReg.totalCount(dragEventTypes), 0, "Window drag listeners detach on mouseup");

      // Touch cycle also detaches cleanly
      canvasReg.emit("touchstart", { touches: [{ clientX: 140, clientY: 80 }] });
      assert.ok(winReg.count("touchmove") === 1 && winReg.count("touchend") === 1, "Touch drag attaches window listeners");
      winReg.emit("touchend", {});
      assert.equal(winReg.totalCount(dragEventTypes), 0, "Window drag listeners detach on touchend");
    } finally {
      if (hadWindow) g.window = prevWindow;
      else delete g.window;
    }
  });

  it("playCompletionChime closes its transient AudioContext on oscillator ended", () => {
    const g = globalThis as Record<string, unknown>;
    const hadWindow = Object.prototype.hasOwnProperty.call(g, "window");
    const prevWindow = g.window;

    let closeCalls = 0;
    const captured: { osc: { onended?: (() => void) | null } | null } = { osc: null };

    class MockAudioContext {
      currentTime = 0;
      destination = {};
      createOscillator() {
        const osc = {
          type: "sine",
          frequency: { setValueAtTime() {} },
          connect() {},
          start() {},
          stop() {},
          onended: null as (() => void) | null,
        };
        captured.osc = osc;
        return osc;
      }
      createGain() {
        return {
          gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
          connect() {},
        };
      }
      close() {
        closeCalls++;
        return Promise.resolve();
      }
    }

    g.window = { AudioContext: MockAudioContext };
    try {
      playCompletionChime();
      assert.ok(captured.osc && typeof captured.osc.onended === "function", "Oscillator must register onended callback");
      captured.osc.onended();
      assert.equal(closeCalls, 1, "Transient chime AudioContext must close after playback ends");
    } finally {
      if (hadWindow) g.window = prevWindow;
      else delete g.window;
    }
  });

  it("handleCustomBgmUpload closes transient AudioContext on both decode success and failure", async () => {
    const g = globalThis as Record<string, unknown>;
    const hadWindow = Object.prototype.hasOwnProperty.call(g, "window");
    const prevWindow = g.window;
    const hadDoc = Object.prototype.hasOwnProperty.call(g, "document");
    const prevDoc = g.document;

    audioSubtitleStore.reset();
    const toastEl = {
      id: "filmChainToast",
      style: {} as Record<string, string>,
      textContent: "",
    };
    g.document = {
      getElementById: (id: string) => (id === "filmChainToast" ? toastEl : null),
      createElement: () => toastEl,
      body: { appendChild() {} },
    };

    let closeCalls = 0;
    let shouldFail = false;

    class MockDecodeAudioContext {
      decodeAudioData() {
        if (shouldFail) {
          return Promise.reject(new Error("Corrupt audio"));
        }
        return Promise.resolve({ duration: 12.4 });
      }
      close() {
        closeCalls++;
        return Promise.resolve();
      }
    }

    g.window = { AudioContext: MockDecodeAudioContext };
    const fakeInput = {
      files: [
        {
          name: "bgm.mp3",
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
        },
      ],
    } as unknown as HTMLInputElement;

    try {
      await handleCustomBgmUpload(fakeInput);
      assert.equal(closeCalls, 1, "AudioContext must close after successful custom BGM decode");

      shouldFail = true;
      await handleCustomBgmUpload(fakeInput);
      assert.equal(closeCalls, 2, "AudioContext must close in finally block when decode fails");
    } finally {
      audioSubtitleStore.reset();
      if (hadWindow) g.window = prevWindow;
      else delete g.window;
      if (hadDoc) g.document = prevDoc;
      else delete g.document;
    }
  });
});
