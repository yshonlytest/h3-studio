import type { DialogueTrackItem } from "../types/studio.ts";
import { createStore } from "./createStore.ts";

export interface AudioSubtitleState extends Record<string, unknown> {
  currentDialogueItems: DialogueTrackItem[];
  bgmAudioCtx: AudioContext | null;
  bgmAudioSource: AudioBufferSourceNode | null;
  bgmGainNode: GainNode | null;
  isBgmPlaying: boolean;
  customBgmAudioBuffer: AudioBuffer | null;
  softSubtitleEnabled: boolean;
}

function createInitialAudioSubtitleState(): AudioSubtitleState {
  return {
    currentDialogueItems: [],
    bgmAudioCtx: null,
    bgmAudioSource: null,
    bgmGainNode: null,
    isBgmPlaying: false,
    customBgmAudioBuffer: null,
    softSubtitleEnabled: true,
  };
}

const store = createStore<AudioSubtitleState>(createInitialAudioSubtitleState, {
  opaqueKeys: ["bgmAudioCtx", "bgmAudioSource", "bgmGainNode", "customBgmAudioBuffer"],
});

export const audioSubtitleStore = {
  ...store,

  setDialogueItems(items: DialogueTrackItem[]): void {
    store.setState({ currentDialogueItems: items });
  },

  setSoftSubtitleEnabled(enabled: boolean): void {
    store.setState({ softSubtitleEnabled: enabled });
  },

  setBgmPlaying(playing: boolean): void {
    store.setState({ isBgmPlaying: playing });
  },

  patchAudio(patch: Partial<AudioSubtitleState>): void {
    store.setState(patch);
  },
};
