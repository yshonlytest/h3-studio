import type { EduChapterOutline, LexiconData, StoryboardPlan, StoryboardSegment } from "../types/studio.ts";
import { createStore } from "./createStore.ts";

export interface StoryboardState extends Record<string, unknown> {
  currentPlan: StoryboardPlan | null;
  refImageBase64: string;
  refImageMime: string;
  gridImageDataUrl: string;
  gridImageBlob: Blob | null;
  slicedPanelsDataUrls: Record<string, string>;
  parsedEduChapters: EduChapterOutline[];
  activeLexiconData: LexiconData;
  currentEditingPanelIndex: number;
}

export interface StoryboardSnapshot {
  currentPlan: StoryboardPlan | null;
  refImageBase64: string;
  refImageMime: string;
  gridImageDataUrl: string;
  slicedPanelsDataUrls: Record<string, string>;
  parsedEduChapters: EduChapterOutline[];
  activeLexiconData: LexiconData;
  currentEditingPanelIndex: number;
}

const DEFAULT_LEXICON_DATA: LexiconData = {
  "zh-TW": {
    "作業成本": "作葉成本",
    "大立腕": "大立萬",
    "立腕": "立萬",
    "調用": "吊用",
    "調度": "吊度",
    "算力調度": "算力吊度",
    "多機位調度": "多機位吊度",
    "自由調度": "自由吊度",
    "調配": "吊配",
    "調動": "吊動",
    "調派": "吊派",
    "重抽": "蟲抽",
    "重算": "蟲算",
    "重置": "蟲置",
    "重新": "蟲新",
    "重複": "蟲復",
    "行數": "航數",
    "行距": "航距",
    "處置": "楚置",
    "處理": "楚理",
    "資本權重": "資本全重",
    "資金調撥": "資金條撥",
    "會計系統": "快計系統",
  },
};

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createInitialStoryboardState(): StoryboardState {
  return {
    currentPlan: null,
    refImageBase64: "",
    refImageMime: "image/jpeg",
    gridImageDataUrl: "",
    gridImageBlob: null,
    slicedPanelsDataUrls: {},
    parsedEduChapters: [],
    activeLexiconData: cloneJson(DEFAULT_LEXICON_DATA),
    currentEditingPanelIndex: 1,
  };
}

const store = createStore<StoryboardState>(createInitialStoryboardState, {
  opaqueKeys: ["gridImageBlob"],
});

export const storyboardStore = {
  ...store,

  setPlan(plan: StoryboardPlan | null): void {
    store.setState({ currentPlan: plan });
  },

  updateSegments(segments: StoryboardSegment[]): void {
    const currentPlan = store.getState().currentPlan;
    if (!currentPlan) return;
    store.setState({
      currentPlan: {
        ...currentPlan,
        segments: segments.map((s) => ({ ...s })),
      },
    });
  },

  updateSegmentAt(index: number, patch: Partial<StoryboardSegment>): void {
    const currentPlan = store.getState().currentPlan;
    if (!currentPlan || !Array.isArray(currentPlan.segments)) return;
    if (index < 0 || index >= currentPlan.segments.length) return;
    store.setState({
      currentPlan: {
        ...currentPlan,
        segments: currentPlan.segments.map((seg, i) => (i === index ? { ...seg, ...patch } : seg)),
      },
    });
  },

  updatePlanMeta(patch: Partial<Omit<StoryboardPlan, "segments">>): void {
    const currentPlan = store.getState().currentPlan;
    if (!currentPlan) return;
    store.setState({
      currentPlan: {
        ...currentPlan,
        ...patch,
      },
    });
  },

  setRefImage(base64: string, mime = "image/jpeg"): void {
    store.setState({ refImageBase64: base64, refImageMime: mime });
  },

  setGridImage(dataUrl: string, blob: Blob | null = null): void {
    store.setState({ gridImageDataUrl: dataUrl, gridImageBlob: blob });
  },

  setSlicedPanels(panels: Record<string, string>): void {
    store.setState({ slicedPanelsDataUrls: panels });
  },

  setParsedEduChapters(chapters: EduChapterOutline[]): void {
    store.setState({ parsedEduChapters: chapters });
  },

  setLexiconData(lexicon: LexiconData): void {
    store.setState({ activeLexiconData: lexicon });
  },

  setEditingPanelIndex(index: number): void {
    store.setState({ currentEditingPanelIndex: index });
  },

  patchStoryboard(patch: Partial<StoryboardState>): void {
    store.setState(patch);
  },

  toSnapshot(): StoryboardSnapshot {
    const s = store.getState();
    return {
      currentPlan: s.currentPlan ? cloneJson(s.currentPlan) : null,
      refImageBase64: s.refImageBase64,
      refImageMime: s.refImageMime,
      gridImageDataUrl: s.gridImageDataUrl,
      slicedPanelsDataUrls: { ...s.slicedPanelsDataUrls },
      parsedEduChapters: cloneJson(s.parsedEduChapters),
      activeLexiconData: cloneJson(s.activeLexiconData),
      currentEditingPanelIndex: s.currentEditingPanelIndex,
    };
  },

  hydrate(snapshot: Partial<StoryboardSnapshot>): void {
    const current = store.getState();
    store.setState({
      ...current,
      currentPlan: snapshot.currentPlan !== undefined ? cloneJson(snapshot.currentPlan) : current.currentPlan,
      refImageBase64: snapshot.refImageBase64 ?? current.refImageBase64,
      refImageMime: snapshot.refImageMime ?? current.refImageMime,
      gridImageDataUrl: snapshot.gridImageDataUrl ?? current.gridImageDataUrl,
      slicedPanelsDataUrls: snapshot.slicedPanelsDataUrls ? { ...snapshot.slicedPanelsDataUrls } : current.slicedPanelsDataUrls,
      parsedEduChapters: snapshot.parsedEduChapters ? cloneJson(snapshot.parsedEduChapters) : current.parsedEduChapters,
      activeLexiconData: snapshot.activeLexiconData ? cloneJson(snapshot.activeLexiconData) : current.activeLexiconData,
      currentEditingPanelIndex: snapshot.currentEditingPanelIndex ?? current.currentEditingPanelIndex,
    });
  },
};
