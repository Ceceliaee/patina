import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export interface CurrentWindowForegroundState {
  visible: boolean;
  focused: boolean;
  foregroundLike: boolean;
}

export type MainWindowReadyOutcome = "stale" | "duplicate" | "hidden" | "revealed";

export interface MainWindowReadyResult {
  outcome: MainWindowReadyOutcome;
  generation: number;
  loadEpoch: number;
}

export interface MainWindowRenderToken {
  generation: number;
  loadEpoch: number;
}

declare global {
  interface Window {
    __PATINA_MAIN_WINDOW_GENERATION__?: number;
  }
}

const MAIN_WINDOW_LABEL = "main";
const MAIN_WINDOW_READY_OUTCOMES = new Set<MainWindowReadyOutcome>([
  "stale",
  "duplicate",
  "hidden",
  "revealed",
]);

function parseMainWindowReadyResult(value: unknown): MainWindowReadyResult {
  if (typeof value !== "object" || value === null) {
    throw new Error("main-window ready command returned an invalid result");
  }

  const candidate = value as {
    outcome?: unknown;
    generation?: unknown;
    loadEpoch?: unknown;
  };
  if (
    typeof candidate.outcome !== "string"
    || !MAIN_WINDOW_READY_OUTCOMES.has(candidate.outcome as MainWindowReadyOutcome)
    || typeof candidate.generation !== "number"
    || !Number.isSafeInteger(candidate.generation)
    || candidate.generation < 1
    || typeof candidate.loadEpoch !== "number"
    || !Number.isSafeInteger(candidate.loadEpoch)
    || candidate.loadEpoch < 1
  ) {
    throw new Error("main-window ready command returned an invalid contract");
  }

  return {
    outcome: candidate.outcome as MainWindowReadyOutcome,
    generation: candidate.generation,
    loadEpoch: candidate.loadEpoch,
  };
}

function parseMainWindowRenderToken(value: unknown): MainWindowRenderToken {
  if (typeof value !== "object" || value === null) {
    throw new Error("main-window render token command returned an invalid result");
  }

  const candidate = value as { generation?: unknown; loadEpoch?: unknown };
  if (
    typeof candidate.generation !== "number"
    || !Number.isSafeInteger(candidate.generation)
    || candidate.generation < 1
    || typeof candidate.loadEpoch !== "number"
    || !Number.isSafeInteger(candidate.loadEpoch)
    || candidate.loadEpoch < 1
  ) {
    throw new Error("main-window render token command returned an invalid contract");
  }

  return {
    generation: candidate.generation,
    loadEpoch: candidate.loadEpoch,
  };
}

export function readCurrentMainWindowGeneration(): number | null {
  if (typeof window === "undefined" || getCurrentWindow().label !== MAIN_WINDOW_LABEL) {
    return null;
  }

  const generation = window.__PATINA_MAIN_WINDOW_GENERATION__;
  return typeof generation === "number"
    && Number.isSafeInteger(generation)
    && generation >= 1
    ? generation
    : null;
}

export async function markCurrentMainWindowReady(
  token: MainWindowRenderToken,
): Promise<MainWindowReadyResult> {
  if (getCurrentWindow().label !== MAIN_WINDOW_LABEL) {
    throw new Error("only the main window can report main-window readiness");
  }

  return parseMainWindowReadyResult(await invoke<unknown>("cmd_mark_main_window_ready", {
    generation: token.generation,
    loadEpoch: token.loadEpoch,
  }));
}

export async function readCurrentMainWindowRenderToken(): Promise<MainWindowRenderToken> {
  if (getCurrentWindow().label !== MAIN_WINDOW_LABEL) {
    throw new Error("only the main window can read main-window render state");
  }

  return parseMainWindowRenderToken(
    await invoke<unknown>("cmd_get_main_window_render_token"),
  );
}

export async function minimizeCurrentWindow(): Promise<void> {
  await invoke("cmd_minimize_main_window");
}

export async function toggleCurrentWindowMaximized(): Promise<void> {
  await getCurrentWindow().toggleMaximize();
}

export async function closeCurrentWindow(): Promise<void> {
  await getCurrentWindow().close();
}

export async function startCurrentWindowDrag(): Promise<void> {
  await getCurrentWindow().startDragging();
}

export async function watchCurrentWindowMaximized(
  handler: (maximized: boolean) => void,
): Promise<() => void> {
  const currentWindow = getCurrentWindow();

  const syncMaximizedState = () => {
    void currentWindow.isMaximized()
      .then(handler)
      .catch((error) => {
        console.warn("read current window maximized state failed", error);
      });
  };

  syncMaximizedState();
  return currentWindow.onResized(syncMaximizedState);
}

export async function readCurrentWindowForegroundState(): Promise<CurrentWindowForegroundState> {
  try {
    const currentWindow = getCurrentWindow();
    const [visible, focused] = await Promise.all([
      currentWindow.isVisible(),
      currentWindow.isFocused(),
    ]);

    return {
      visible,
      focused,
      foregroundLike: visible || focused,
    };
  } catch (error) {
    console.warn("read current window foreground state failed", error);
    return {
      visible: true,
      focused: true,
      foregroundLike: true,
    };
  }
}

export async function watchCurrentWindowForegroundState(
  handler: (state: CurrentWindowForegroundState) => void,
): Promise<() => void> {
  const currentWindow = getCurrentWindow();

  const syncForegroundState = () => {
    void readCurrentWindowForegroundState().then(handler);
  };
  const unlisteners: Array<() => void> = [];

  syncForegroundState();

  try {
    unlisteners.push(await currentWindow.onFocusChanged(syncForegroundState));
    unlisteners.push(await currentWindow.onResized(syncForegroundState));
  } catch (error) {
    for (const unlisten of unlisteners.splice(0)) {
      unlisten();
    }
    console.warn("watch current window foreground state failed", error);
  }

  return () => {
    for (const unlisten of unlisteners.splice(0)) {
      unlisten();
    }
  };
}
