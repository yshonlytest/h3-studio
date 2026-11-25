export type ProjectMode = "creative" | "edu";

export type StartWorkflowMode = "web" | "agent";

export type ComputeRoute = "colab" | "saas_api" | "local";

export type SpeedKey = "quality" | "balanced" | "fast";

export interface SpeedConfig {
  mode: string;
  width: number;
  height: number;
  steps: number;
  layers: string;
  reuse: number;
  core_reuse: number;
  token_reduction: boolean;
  render_width: number;
  render_height: number;
}

export interface StoryboardSegment {
  title: string;
  end_panel: number;
  chain_mode?: string;
  prompt: string;
  display_dialogue?: string;
  spoken_dialogue?: string;
  dialogue?: string;
  frames?: number;
  shot_type?: string;
  staging_track?: unknown;
  context_ir?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface StoryboardPlan {
  project_slug: string;
  project_mode?: string;
  anchor_ref_image?: string;
  grid_image_name?: string;
  recommended_total_seconds: number;
  reasoning_zh: string;
  expanded_story_zh: string;
  grid_image_prompt?: string;
  segments: StoryboardSegment[];
  [key: string]: unknown;
}

export interface PlaylistItem {
  title: string;
  url: string;
  [key: string]: unknown;
}

export interface DialogueTrackItem {
  partIndex: number;
  partTitle: string;
  role: string;
  text: string;
  baseSec: number;
  segDurationSec: number;
  startOffsetSec: number;
  durationSec: number;
  userEdited: boolean;
  audioBlobUrl: string | null;
}

export type LexiconData = Record<string, Record<string, string> | unknown>;

export interface EduChapterOutline {
  title: string;
  body: string;
  word_count: number;
  est_shots: number;
  est_duration_sec: number;
}

export interface LocalEnvState {
  daemon: string;
  hardware: {
    availableGiB: number | null;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface DemoProjectConfig {
  width: number;
  height: number;
  frames: number;
  steps: number;
  layers: string;
  reuse: number;
  seed: number;
  trim_first_frames: number;
  ref_image_path: string;
  grid_image_path: string;
  grid_image_name: string;
  merged_video_path: string;
  part_videos: PlaylistItem[];
  chinese_desc: string;
  plan: StoryboardPlan;
}

declare global {
  interface Window {
    H3TimecodeHelper?: Record<string, (...args: any[]) => any>;
    H3Prompts?: Record<string, any>;
    H3PromptBuilder?: Record<string, (...args: any[]) => any>;
    H3ComfyPayload?: Record<string, any>;
    H3CloudDiagnostics?: Record<string, (...args: any[]) => any>;
    H3CloudApiAdapter?: Record<string, any>;
    H3AudioStudio?: Record<string, (...args: any[]) => any>;
    H3ProjectStore?: Record<string, (...args: any[]) => any>;
    H3WorkspaceSync?: Record<string, (...args: any[]) => any>;
    H3LocalEnv?: {
      getState: () => LocalEnvState;
      isDaemonOnline: () => boolean;
      checkNow: (() => boolean | Promise<boolean> | void) | null;
      startRender: ((...args: any[]) => any) | null;
      pingAttention?: () => void;
      subscribe: (fn: (state: LocalEnvState) => void) => () => void;
    };
    showSaveFilePicker?: (...args: any[]) => Promise<any>;
    H3StudioApplyPlan?: (planOrSegments: unknown, options?: Record<string, unknown>) => boolean;
    showToast?: (message: string, duration?: number) => void;
    exportChainedManifest?: (silent?: boolean) => Record<string, unknown> | null;
    h3StudioStartLocalRender?: () => Promise<void>;
    applyPhoneticSubstitutions?: (text: string, lang?: string) => string;
    rerollShotAudio?: (shotIdx: number) => Promise<void>;
    replaceShotSpeechOnly?: (shotIdx: number) => Promise<void>;
    currentActiveProjectId?: string;
    webkitAudioContext?: typeof AudioContext;
  }
}
