import { useEffect, useState } from "react";
import {
  resolveQuietMotionMode,
  type QuietMotionMode,
} from "./quietMotion.ts";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function readPrefersReducedMotion() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }

  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

export function useQuietMotionPreference(enhancedMotionEnabled: boolean): QuietMotionMode {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(readPrefersReducedMotion);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return undefined;
    }

    const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);
    const syncPreference = () => setPrefersReducedMotion(mediaQuery.matches);

    syncPreference();
    mediaQuery.addEventListener("change", syncPreference);
    return () => mediaQuery.removeEventListener("change", syncPreference);
  }, []);

  return resolveQuietMotionMode({
    enhancedMotionEnabled,
    prefersReducedMotion,
  });
}
