export const NAVIGATION_COMMIT_FALLBACK_MS = 50;

export interface NavigationCommitScheduler {
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(handle: number): void;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(handle: number): void;
}

export function scheduleNavigationCommit(
  callback: () => void,
  scheduler: NavigationCommitScheduler = window,
): () => void {
  let settled = false;
  let frameHandle: number | null = null;
  let timeoutHandle: number | null = null;

  const clearScheduledWork = () => {
    if (frameHandle !== null) {
      scheduler.cancelAnimationFrame(frameHandle);
      frameHandle = null;
    }
    if (timeoutHandle !== null) {
      scheduler.clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
  };

  const commit = () => {
    if (settled) return;
    settled = true;
    clearScheduledWork();
    callback();
  };

  frameHandle = scheduler.requestAnimationFrame(commit);
  if (!settled) {
    timeoutHandle = scheduler.setTimeout(commit, NAVIGATION_COMMIT_FALLBACK_MS);
  }

  return () => {
    if (settled) return;
    settled = true;
    clearScheduledWork();
  };
}
