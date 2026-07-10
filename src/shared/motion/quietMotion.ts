export type QuietMotionMode = "baseline" | "enhanced" | "reduced";

export function resolveQuietMotionMode(options: {
  enhancedMotionEnabled: boolean;
  prefersReducedMotion: boolean;
}): QuietMotionMode {
  if (options.prefersReducedMotion) {
    return "reduced";
  }

  if (options.enhancedMotionEnabled) {
    return "enhanced";
  }

  return "baseline";
}

export function quietMotionClass(className: string, mode: QuietMotionMode): string {
  return mode === "enhanced" ? className : "";
}
