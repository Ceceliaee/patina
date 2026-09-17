import { useAppIconRevision } from "../../shared/hooks/appIconChanges.ts";
import { useEffect, useMemo, useState } from "react";
import { loadWidgetObjectIcon } from "../widget/widgetIconService.ts";

export function useWidgetObjectIcon(objectIconKey: string | null) {
  const names = useMemo(() => objectIconKey ? [objectIconKey] : [], [objectIconKey]);
  const revision = useAppIconRevision(names);
  const [loaded, setLoaded] = useState<{ key: string | null; icon: string | null }>({ key: null, icon: null });

  useEffect(() => {
    if (!objectIconKey) return;

    let cancelled = false;
    void loadWidgetObjectIcon(objectIconKey)
      .then((nextIcon) => {
        if (!cancelled) {
          setLoaded({ key: objectIconKey, icon: nextIcon });
        }
      })
      .catch((error) => {
        if (!cancelled) {
        console.warn("widget:icon", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [objectIconKey, revision]);

  return objectIconKey && loaded.key === objectIconKey ? loaded.icon : null;
}
