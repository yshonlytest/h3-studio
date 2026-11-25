import "./types/studio.ts";
import { registerWindowBindings } from "./registry/windowBindings.ts";
import { bindInfoTipGlobalEvents } from "./features/uiShell.ts";
import { registerStudioBootstrap } from "./bootstrap.ts";

export const STUDIO_BUNDLE_VERSION = "2.1.0-phase-a";

registerWindowBindings();
bindInfoTipGlobalEvents();
registerStudioBootstrap();
