export type QuietMotionMode = "baseline" | "enhanced" | "reduced";

export function resolveQuietMotionMode(options: {
  enhancedMotionEnabled: boolean;
  prefersReducedMotion: boolean;
}): QuietMotionMode {
  if (options.enhancedMotionEnabled) {
    return "enhanced";
  }

  if (options.prefersReducedMotion) {
    return "reduced";
  }

  return "baseline";
}

export function quietMotionClass(className: string, mode: QuietMotionMode): string {
  return mode === "enhanced" ? className : "";
}
