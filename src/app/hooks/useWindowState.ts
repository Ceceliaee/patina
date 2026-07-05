import { useEffect, useState } from "react";
import {
  watchCurrentWindowForegroundState,
  watchCurrentWindowMaximized,
} from "../../platform/desktop/windowControlGateway";

type UseWindowStateResult = {
  isWindowMaximized: boolean;
  isDocumentVisible: boolean;
  isWindowForegroundLike: boolean;
  isForegroundReady: boolean;
};

export function useWindowState(): UseWindowStateResult {
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [isDocumentVisible, setIsDocumentVisible] = useState(() => (
    typeof document === "undefined" ? true : document.visibilityState !== "hidden"
  ));
  const [isWindowForegroundLike, setIsWindowForegroundLike] = useState(true);

  const isForegroundReady = isDocumentVisible && isWindowForegroundLike;

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
      if (unlisten) {
        unlisten();
      }
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
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  return { isWindowMaximized, isDocumentVisible, isWindowForegroundLike, isForegroundReady };
}
