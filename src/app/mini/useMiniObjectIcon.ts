import { useAppIconRevision } from "../../shared/hooks/appIconChanges.ts";
import { useEffect, useMemo, useState } from "react";
import { loadMiniObjectIcon } from "./miniIconService.ts";

export function useMiniObjectIcon(objectIconKey: string | null) {
  const names = useMemo(() => objectIconKey ? [objectIconKey] : [], [objectIconKey]);
  const revision = useAppIconRevision(names);
  const [loaded, setLoaded] = useState<{ key: string | null; icon: string | null }>({ key: null, icon: null });

  useEffect(() => {
    if (!objectIconKey) return;

    let cancelled = false;
    void loadMiniObjectIcon(objectIconKey)
      .then((nextIcon) => {
        if (!cancelled) {
          setLoaded({ key: objectIconKey, icon: nextIcon });
        }
      })
      .catch((error) => {
        if (!cancelled) {
        console.warn("mini:icon", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [objectIconKey, revision]);

  return objectIconKey && loaded.key === objectIconKey ? loaded.icon : null;
}
