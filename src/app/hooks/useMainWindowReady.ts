import { useEffect, useRef } from "react";
import type {
  AppSettings,
  ColorScheme,
  ThemeMode,
} from "../../shared/settings/appSettings.ts";
import {
  markCurrentMainWindowReady,
  readCurrentMainWindowGeneration,
  readCurrentMainWindowRenderToken,
} from "../../platform/desktop/windowControlGateway.ts";
import { isDocumentThemeApplied, useAppThemeMode } from "./useAppThemeMode.ts";

interface ColorSchemePreview {
  light: ColorScheme;
  dark: ColorScheme;
}

interface UseMainWindowReadyOptions {
  appSettings: AppSettings;
  contentReady: boolean;
  themeModePreview: ThemeMode | null;
  colorSchemePreview: ColorSchemePreview | null;
}

declare global {
  interface Window {
    __PATINA_MAIN_WINDOW_LIVENESS_REQUEST__?: () => void;
  }
}

const MAX_FRAME_READY_ATTEMPTS = 25;
const MAX_READY_ATTEMPTS = 3;
const FRAME_READY_RETRY_DELAY_MS = 20;

function hasRenderableMainWindowFrame(
  frame: HTMLDivElement | null,
  themeMode: ThemeMode,
  colorSchemeLight: ColorScheme,
  colorSchemeDark: ColorScheme,
): frame is HTMLDivElement {
  if (
    !frame?.isConnected
    || !isDocumentThemeApplied(themeMode, colorSchemeLight, colorSchemeDark)
  ) {
    return false;
  }

  const frameStyle = window.getComputedStyle(frame);
  const frameBounds = frame.getBoundingClientRect();
  return frameStyle.display !== "none"
    && frameStyle.visibility !== "hidden"
    && frameStyle.backgroundColor !== "transparent"
    && frameStyle.backgroundColor !== "rgba(0, 0, 0, 0)"
    && frameBounds.width > 0
    && frameBounds.height > 0;
}

export function useMainWindowReady({
  appSettings,
  contentReady,
  themeModePreview,
  colorSchemePreview,
}: UseMainWindowReadyOptions) {
  const frameRef = useRef<HTMLDivElement>(null);
  const pendingTokenRef = useRef<string | null>(null);
  const confirmedTokenRef = useRef<string | null>(null);
  const themeMode = themeModePreview ?? appSettings.themeMode;
  const colorSchemeLight = colorSchemePreview?.light ?? appSettings.colorSchemeLight;
  const colorSchemeDark = colorSchemePreview?.dark ?? appSettings.colorSchemeDark;
  useAppThemeMode(themeMode, colorSchemeLight, colorSchemeDark);

  useEffect(() => {
    if (!contentReady) {
      return undefined;
    }

    const generation = readCurrentMainWindowGeneration();
    if (generation === null) {
      console.error("main-window generation is unavailable; window will remain hidden");
      return undefined;
    }

    let active = true;
    let readinessInFlight = false;
    let retryTimerId: number | null = null;
    let resolveRetryTimer: (() => void) | null = null;

    const waitForRetry = () => new Promise<void>((resolve) => {
      resolveRetryTimer = resolve;
      retryTimerId = window.setTimeout(() => {
        retryTimerId = null;
        resolveRetryTimer = null;
        resolve();
      }, FRAME_READY_RETRY_DELAY_MS);
    });

    const waitForRenderableFrame = async () => {
      for (
        let attempt = 1;
        active && attempt <= MAX_FRAME_READY_ATTEMPTS;
        attempt += 1
      ) {
        if (
          hasRenderableMainWindowFrame(
            frameRef.current,
            themeMode,
            colorSchemeLight,
            colorSchemeDark,
          )
        ) {
          return true;
        }
        await waitForRetry();
      }
      return false;
    };

    const reportReady = async () => {
      for (let attempt = 1; attempt <= MAX_READY_ATTEMPTS; attempt += 1) {
        if (!active) {
          pendingTokenRef.current = null;
          return;
        }
        try {
          const token = await readCurrentMainWindowRenderToken();
          if (token.generation !== generation) {
            throw new Error("main-window generation changed before readiness");
          }
          const tokenKey = `${token.generation}:${token.loadEpoch}`;
          if (
            pendingTokenRef.current === tokenKey
            || confirmedTokenRef.current === tokenKey
          ) {
            return;
          }

          pendingTokenRef.current = tokenKey;
          const result = await markCurrentMainWindowReady(token);
          pendingTokenRef.current = null;
          if (
            result.outcome !== "stale"
            && result.generation === token.generation
            && result.loadEpoch === token.loadEpoch
          ) {
            confirmedTokenRef.current = tokenKey;
            return;
          }
        } catch (error) {
          if (attempt === MAX_READY_ATTEMPTS || !active) {
            pendingTokenRef.current = null;
            console.error("main-window ready handshake failed; window will remain hidden", error);
            return;
          }

          await waitForRetry();
        }
      }
    };

    const verifyAndReportReady = async () => {
      if (!active || readinessInFlight) {
        return;
      }

      readinessInFlight = true;
      try {
        const ready = await waitForRenderableFrame();
        if (ready && active) {
          await reportReady();
        } else if (active) {
          console.error("main-window frame did not become renderable; window will remain hidden");
        }
      } finally {
        readinessInFlight = false;
      }
    };

    const handleLivenessRequest = () => {
      void verifyAndReportReady();
    };
    window.__PATINA_MAIN_WINDOW_LIVENESS_REQUEST__ = handleLivenessRequest;
    void verifyAndReportReady();

    return () => {
      active = false;
      pendingTokenRef.current = null;
      if (window.__PATINA_MAIN_WINDOW_LIVENESS_REQUEST__ === handleLivenessRequest) {
        delete window.__PATINA_MAIN_WINDOW_LIVENESS_REQUEST__;
      }
      if (retryTimerId !== null) {
        window.clearTimeout(retryTimerId);
        retryTimerId = null;
        resolveRetryTimer?.();
        resolveRetryTimer = null;
      }
    };
  }, [colorSchemeDark, colorSchemeLight, contentReady, frameRef, themeMode]);

  return frameRef;
}
