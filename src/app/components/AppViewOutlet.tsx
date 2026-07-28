import { Suspense, type ReactNode } from "react";
import type { UiText } from "../../shared/copy/index.ts";
import type { View } from "../types/view.ts";

interface AppViewOutletProps {
  renderedView: View;
  uiText: UiText;
  views: Record<View, ReactNode>;
}

export default function AppViewOutlet({
  renderedView,
  uiText,
  views,
}: AppViewOutletProps) {
  return (
    <main className="qp-canvas flex-1 min-h-0 flex flex-col gap-4 md:gap-5 p-4 md:p-5 relative overflow-hidden">
      <Suspense
        fallback={
          <div className="flex-1 min-h-0 flex items-center justify-center text-[var(--qp-text-tertiary)] text-sm">
            {uiText.app.loadingView}
          </div>
        }
      >
        <div
          key={renderedView}
          className="qp-view-container flex-1 min-h-0 flex flex-col h-full overflow-hidden"
        >
          {views[renderedView]}
        </div>
      </Suspense>
    </main>
  );
}
