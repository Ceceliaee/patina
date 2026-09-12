import { startTransition, useEffect, useMemo, useRef, useState } from "react";

type LoadRequestedAppIcons = (exeNames: string[]) => Promise<Record<string, string>>;

interface UseRequestedAppIconsOptions {
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

function reuseEqualIconSnapshot(
  currentIcons: Record<string, string>,
  nextIcons: Record<string, string>,
): Record<string, string> {
  const entries = Object.entries(nextIcons);
  return Object.keys(currentIcons).length === entries.length
    && entries.every(([key, icon]) => currentIcons[key] === icon)
    ? currentIcons
    : nextIcons;
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
          // Loaders return the bounded cache snapshot; accumulating old snapshots defeats its eviction.
          setLoadedIcons((currentIcons) => reuseEqualIconSnapshot(currentIcons, nextIcons));
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
