import type { ProjectMode, StartWorkflowMode } from "../types/studio.ts";
import { createStore } from "./createStore.ts";

export interface CoreState extends Record<string, unknown> {
  activeProjectMode: ProjectMode;
  activeStartWorkflowMode: StartWorkflowMode;
  currentActiveProjectId: string;
  currentActiveProjectName: string;
  currentSessionId: string;
  isRestoringProject: boolean;
  autoSaveTimer: ReturnType<typeof setTimeout> | null;
  lastRelaySyncOk: boolean;
  sseSource: EventSource | null;
  sessionPollInterval: ReturnType<typeof setInterval> | null;
}

function createInitialCoreState(): CoreState {
  return {
    activeProjectMode: "creative",
    activeStartWorkflowMode: "web",
    currentActiveProjectId: "fc_detective_25s_demo",
    currentActiveProjectName: "🎬 賽博偵探 25s 電影級示範專案",
    currentSessionId: "",
    isRestoringProject: false,
    autoSaveTimer: null,
    lastRelaySyncOk: false,
    sseSource: null,
    sessionPollInterval: null,
  };
}

const store = createStore<CoreState>(createInitialCoreState, {
  opaqueKeys: ["autoSaveTimer", "sseSource", "sessionPollInterval"],
});

export const coreStore = {
  ...store,

  setProjectMode(mode: ProjectMode): void {
    store.setState({ activeProjectMode: mode });
  },

  setStartWorkflowMode(mode: StartWorkflowMode): void {
    store.setState({ activeStartWorkflowMode: mode });
  },

  setActiveProject(projectId: string, projectName?: string): void {
    const patch: Partial<CoreState> = { currentActiveProjectId: projectId };
    if (typeof projectName === "string") {
      patch.currentActiveProjectName = projectName;
    }
    store.setState(patch);
  },

  setSessionId(sessionId: string): void {
    store.setState({ currentSessionId: sessionId });
  },

  setRestoringProject(restoring: boolean): void {
    store.setState({ isRestoringProject: restoring });
  },

  setAutoSaveTimer(timer: ReturnType<typeof setTimeout> | null): void {
    store.setState({ autoSaveTimer: timer });
  },

  setLastRelaySyncOk(ok: boolean): void {
    store.setState({ lastRelaySyncOk: ok });
  },

  setSseSource(source: EventSource | null): void {
    store.setState({ sseSource: source });
  },

  setSessionPollInterval(interval: ReturnType<typeof setInterval> | null): void {
    store.setState({ sessionPollInterval: interval });
  },

  patchCore(patch: Partial<CoreState>): void {
    store.setState(patch);
  },
};
