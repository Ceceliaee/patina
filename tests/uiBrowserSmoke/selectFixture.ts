import { createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import QuietSelect from "../../src/shared/components/QuietSelect.tsx";

export function mountSelectFixture() {
  const host = document.createElement("div");
  host.id = "select-refresh-fixture";
  host.style.cssText = "position:fixed;top:100px;left:200px;z-index:9999";
  document.body.append(host);
  const root = createRoot(host);
  function Fixture({ revision, value }: { revision: number; value: string }) {
    useEffect(() => { host.dataset.revision = String(revision); }, [revision]);
    return createElement(QuietSelect<string>, {
      value,
      options: [{ value: "first", label: "First" }, { value: "second", label: "Second" }],
      ariaLabel: "Refresh fixture",
      onChange: (next) => { host.dataset.chosen = next; },
    });
  }
  const render = (revision: number, value = "second") => root.render(createElement(Fixture, { revision, value }));
  render(0);
  return { render, dispose: () => { root.unmount(); host.remove(); } };
}
