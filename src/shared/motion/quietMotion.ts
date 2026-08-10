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
