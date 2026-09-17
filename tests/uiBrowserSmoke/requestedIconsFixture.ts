import { publishAppIconChange } from "../../src/shared/hooks/appIconChanges.ts";
import { createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { useRequestedAppIcons } from "../../src/shared/hooks/useRequestedAppIcons.ts";

// Loaded by the browser test through Vite, so effects and transitions use React's
// real scheduler rather than a hook mock or server-rendered approximation.
export function createRequestedIconsProbe() {
  const host = document.createElement("div");
  host.hidden = true;
  document.body.append(host);
  const root = createRoot(host);
  const baseIcons = { "base.exe": "base-icon" };
  let current: Record<string, string> = {};
  let commits = 0;
  const errors: string[] = [];
  const pending: Array<{
    names: string[];
    resolve: (value: Record<string, string>) => void;
    reject: (error: Error) => void;
  }> = [];
  const loadIcons = (names: string[]) => new Promise<Record<string, string>>((resolve, reject) => {
    pending.push({ names, resolve, reject });
  });
  function Probe({ names }: { names: string[] }) {
    const icons = useRequestedAppIcons({ baseIcons, exeNames: names, loadIcons,
      onError: (error) => errors.push(String(error)) });
    useEffect(() => { current = icons; commits += 1; }, [icons]);
    return null;
  }
  return {
    change: (name: string | null) => publishAppIconChange(name),
    render: (names: string[]) => root.render(createElement(Probe, { names })),
    read: () => ({ icons: current, commits, errors: [...errors], requests: pending.map(({ names }) => names) }),
    resolve: (index: number, value: Record<string, string>) => pending[index].resolve(value),
    reject: (index: number) => pending[index].reject(new Error("obsolete icon request")),
    dispose: () => { root.unmount(); host.remove(); },
  };
}
