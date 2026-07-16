import { startTransition, useEffect, useMemo, useRef, useState } from "react";

export type LoadRequestedAppIcons = (exeNames: string[]) => Promise<Record<string, string>>;

export interface UseRequestedAppIconsOptions {
  baseIcons: Record<string, string>;
  exeNames: readonly (string | null | undefined)[];
  loadIcons: LoadRequestedAppIcons;
  enabled?: boolean;
  onError?: (error: unknown) => void;
}

function normalizeRequestedExeNames(exeNames: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const exeName of exeNames) {
    const rawExe = exeName?.trim();
    if (!rawExe) continue;

    const key = rawExe.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(rawExe);
  }

  return result;
}

function mergeIconMaps(
  currentIcons: Record<string, string>,
  nextIcons: Record<string, string>,
): Record<string, string> {
  let changed = false;
  const merged = { ...currentIcons };

  for (const [key, icon] of Object.entries(nextIcons)) {
    if (!key.trim() || !icon || merged[key] === icon) continue;

    merged[key] = icon;
    changed = true;
  }

  return changed ? merged : currentIcons;
}

export function useRequestedAppIcons({
  baseIcons,
  exeNames,
  loadIcons,
  enabled = true,
  onError,
}: UseRequestedAppIconsOptions): Record<string, string> {
  const requestedExeNames = useMemo(() => normalizeRequestedExeNames(exeNames), [exeNames]);
  const requestKey = requestedExeNames.join("\u0000");
  const [loadedIcons, setLoadedIcons] = useState<Record<string, string>>({});
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    if (!enabled || requestedExeNames.length === 0) return undefined;

    let cancelled = false;

    void loadIcons(requestedExeNames)
      .then((nextIcons) => {
        if (cancelled) return;

        startTransition(() => {
          setLoadedIcons((currentIcons) => mergeIconMaps(currentIcons, nextIcons));
        });
      })
      .catch((error) => {
        if (cancelled) return;
        onErrorRef.current?.(error);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, loadIcons, requestedExeNames, requestKey]);

  return useMemo(() => ({
    ...baseIcons,
    ...loadedIcons,
  }), [baseIcons, loadedIcons]);
}
