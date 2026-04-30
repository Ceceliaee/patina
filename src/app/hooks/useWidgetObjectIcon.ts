import { useEffect, useState } from "react";
import { loadWidgetObjectIcon } from "../widget/widgetIconService.ts";

export function useWidgetObjectIcon(objectIconKey: string | null) {
  const [icon, setIcon] = useState<string | null>(null);

  useEffect(() => {
    if (!objectIconKey) {
      setIcon(null);
      return;
    }

    let cancelled = false;
    setIcon(null);

    void loadWidgetObjectIcon(objectIconKey)
      .then((nextIcon) => {
        if (!cancelled) {
          setIcon(nextIcon);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn("load widget object icon failed", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [objectIconKey]);

  return objectIconKey ? icon : null;
}
