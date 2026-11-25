export const LOCAL_DAEMON_BASE_URL = "http://127.0.0.1:8080";
export const DEFAULT_COMFY_URL = "http://127.0.0.1:8188";
export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_OPENAI_MODEL = "gpt-4o";
export const DEFAULT_CLOUD_VIDEO_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
export const DEFAULT_CLOUD_VIDEO_MODEL = "doubao-seedance-1-0-pro-250528";

export const STORAGE_KEYS = {
  GEMINI_KEY: "h3_gemini_key",
  OPENAI_KEY: "h3_openai_key",
  OPENAI_BASE: "h3_openai_base",
  OPENAI_MODEL: "h3_openai_model",
  FAL_KEY: "h3_fal_key",
  MINIMAX_KEY: "h3_minimax_key",
  CLOUD_VIDEO_KEY: "h3_cloud_video_key",
  CLOUD_VIDEO_BASE: "h3_cloud_video_base",
  CLOUD_VIDEO_MODEL: "h3_cloud_video_model",
  COMFY_URL: "h3_comfy_url",
  PROMPT_PROVIDER: "h3_prompt_provider",
  IMAGE_PROVIDER: "h3_image_provider",
  SKIP_COST_CONFIRM: "h3_skip_cost_confirm",
  SESSION_ID: "filmchain_session_id",
} as const;

export const MEDIA_CONSTANTS = {
  DEFAULT_FPS: 24,
  DEFAULT_EDU_FRAMES: 124,
  DEFAULT_SEGMENT_SEC: 5,
  EDU_DANGER_CPS: 6.5,
  EDU_DANGER_MIN_CHARS: 12,
  EDU_WARN_CPS: 5.2,
  EDU_WARN_MIN_CHARS: 8,
  STAGING_CANVAS_WIDTH: 280,
  STAGING_CANVAS_HEIGHT: 160,
} as const;

export const TIMING_CONSTANTS = {
  AUTO_SAVE_DEBOUNCE_MS: 500,
  ENV_POLL_INTERVAL_MS: 500,
  ENV_POLL_TIMEOUT_MS: 20000,
  TOAST_DEFAULT_DURATION_MS: 3800,
} as const;
