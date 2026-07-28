import { useEffect, useState } from "react";
import {
  watchCurrentWindowForegroundState,
  watchCurrentWindowMaximized,
} from "../../platform/desktop/windowControlGateway.ts";

interface AppWindowState {
  isForegroundReady: boolean;
  isWindowForegroundLike: boolean;
  isWindowMaximized: boolean;
}

export function useAppWindowState(): AppWindowState {
  const [isDocumentVisible, setIsDocumentVisible] = useState(() => (
    typeof document === "undefined" ? true : document.visibilityState !== "hidden"
  ));
  const [isWindowForegroundLike, setIsWindowForegroundLike] = useState(true);
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;

    const syncDocumentVisibility = () => {
      setIsDocumentVisible(document.visibilityState !== "hidden");
    };

    syncDocumentVisibility();
    document.addEventListener("visibilitychange", syncDocumentVisibility);
    return () => {
      document.removeEventListener("visibilitychange", syncDocumentVisibility);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    void watchCurrentWindowMaximized((maximized) => {
      if (!disposed) {
        setIsWindowMaximized(maximized);
      }
    })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
      })
      .catch((error) => {
        console.warn("watch current window maximized state failed", error);
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    void watchCurrentWindowForegroundState((state) => {
      if (!disposed) {
        setIsWindowForegroundLike(state.foregroundLike);
      }
    })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
      })
      .catch((error) => {
        console.warn("watch current window foreground state failed", error);
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return {
    isForegroundReady: isDocumentVisible && isWindowForegroundLike,
    isWindowForegroundLike,
    isWindowMaximized,
  };
}
