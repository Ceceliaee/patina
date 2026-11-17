export type QuietMotionMode = "baseline" | "reduced";

export function resolveQuietMotionMode(options: {
  prefersReducedMotion: boolean;
}): QuietMotionMode {
  if (options.prefersReducedMotion) {
    return "reduced";
  }

  return "baseline";
}
