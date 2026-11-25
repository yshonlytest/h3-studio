import type { ComputeRoute, PlaylistItem, SpeedKey } from "../types/studio.ts";
import { createStore } from "./createStore.ts";

export interface ComputeState extends Record<string, unknown> {
  activeRoute: ComputeRoute;
  selectedSpeed: SpeedKey;
  detectedLocalEngine: string;
  comfyPollTimer: ReturnType<typeof setInterval> | null;
  comfyActiveWs: WebSocket | null;
  cloudPipelineAbortController: AbortController | null;
  costConfirmPromiseResolve: ((confirmed: boolean) => void) | null;
  currentPlaylist: PlaylistItem[];
  isSeamlessPlaying: boolean;
  seamlessIndex: number;
  pendingCloudSaveTarget: string;
  segmentHistory: Record<string, unknown[]>;
  activeVersionIndex: Record<string, number>;
}

function createInitialComputeState(): ComputeState {
  return {
    activeRoute: "colab",
    selectedSpeed: "quality",
    detectedLocalEngine: "none",
    comfyPollTimer: null,
    comfyActiveWs: null,
    cloudPipelineAbortController: null,
    costConfirmPromiseResolve: null,
    currentPlaylist: [],
    isSeamlessPlaying: false,
    seamlessIndex: 0,
    pendingCloudSaveTarget: "main",
    segmentHistory: {},
    activeVersionIndex: {},
  };
}

const store = createStore<ComputeState>(createInitialComputeState, {
  opaqueKeys: ["comfyPollTimer", "comfyActiveWs", "cloudPipelineAbortController", "costConfirmPromiseResolve"],
});

export const computeStore = {
  ...store,

  setRoute(route: ComputeRoute): void {
    store.setState({ activeRoute: route });
  },

  setSpeed(speed: SpeedKey): void {
    store.setState({ selectedSpeed: speed });
  },

  setDetectedLocalEngine(engine: string): void {
    store.setState({ detectedLocalEngine: engine });
  },

  setPlaylist(playlist: PlaylistItem[]): void {
    store.setState({ currentPlaylist: playlist });
  },

  setSeamlessPlayback(playing: boolean, index?: number): void {
    const patch: Partial<ComputeState> = { isSeamlessPlaying: playing };
    if (typeof index === "number") {
      patch.seamlessIndex = index;
    }
    store.setState(patch);
  },

  patchCompute(patch: Partial<ComputeState>): void {
    store.setState(patch);
  },
};
