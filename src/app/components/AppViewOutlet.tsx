import {
  Suspense,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { UiText } from "../../shared/i18n/index.ts";
import type { View } from "../types/view.ts";

interface AppViewOutletProps {
  onPresentedViewChange?: (view: View) => void;
  renderedView: View;
  uiText: UiText;
  views: Record<View, ReactNode>;
}

export default function AppViewOutlet({
  onPresentedViewChange,
  renderedView,
  uiText,
  views,
}: AppViewOutletProps) {
  const [displayedView, setDisplayedView] = useState<View>(renderedView);
  const [outgoingView, setOutgoingView] = useState<View | null>(null);
  const transitionRequestRef = useRef(0);

  useLayoutEffect(() => {
    if (renderedView === displayedView) return;

    transitionRequestRef.current += 1;
    setOutgoingView((current) => (
      current === renderedView ? null : current ?? displayedView
    ));
    setDisplayedView(renderedView);
  }, [displayedView, renderedView]);

  useLayoutEffect(() => {
    if (outgoingView === null) {
      onPresentedViewChange?.(displayedView);
      return undefined;
    }

    const requestId = transitionRequestRef.current;
    const finishTransition = () => {
      if (transitionRequestRef.current !== requestId) return;
      setOutgoingView(null);
    };

    if (document.visibilityState === "hidden") {
      queueMicrotask(finishTransition);
      return undefined;
    }

    const animationFrameId = window.requestAnimationFrame(finishTransition);
    const fallbackTimerId = window.setTimeout(finishTransition, 50);
    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.clearTimeout(fallbackTimerId);
    };
  }, [displayedView, onPresentedViewChange, outgoingView]);

  const transitionActive = outgoingView !== null;

  return (
    <main
      className="qp-canvas flex-1 min-h-0 flex flex-col gap-4 md:gap-5 p-4 md:p-5 relative overflow-hidden"
      data-presented-view={outgoingView ?? displayedView}
      data-view-transition-state={transitionActive ? "handoff" : "settled"}
    >
      <Suspense
        fallback={
          <div className="flex-1 min-h-0 flex items-center justify-center text-[var(--qp-text-tertiary)] text-sm">
            {uiText.app.loadingView}
          </div>
        }
      >
        <div
          key={displayedView}
          className="qp-view-container flex-1 min-h-0 flex flex-col h-full overflow-hidden"
        >
          {views[displayedView]}
        </div>
        {outgoingView !== null ? (
          <div
            key={outgoingView}
            aria-hidden="true"
            className="qp-view-container qp-view-container-outgoing absolute inset-4 md:inset-5 z-10 flex min-h-0 flex-col overflow-hidden pointer-events-none"
          >
            {views[outgoingView]}
          </div>
        ) : null}
      </Suspense>
    </main>
  );
}
