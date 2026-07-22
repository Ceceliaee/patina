import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowUpCircle, Monitor, Clock, Settings2, Sparkles, BarChart3, Info, ToolCase } from "lucide-react";
import appIconUrl from "../../../src-tauri/icons/32x32.png";
import { UI_TEXT } from "../../shared/copy/index.ts";
import { scheduleNavigationCommit } from "../services/navigationCommitScheduler.ts";
import type { View } from "../types/view";

interface Props {
  currentView: View;
  onPrepareNavigate?: (view: View) => boolean;
  onNavigate: (view: View) => boolean | void | Promise<boolean | void>;
  onPreviewNavigate?: (view: View) => void;
  footerContent?: ReactNode;
  showUpdateEntry?: boolean;
  onOpenUpdateDialog?: () => void;
}

type AppRegionStyle = CSSProperties & { WebkitAppRegion?: "drag" | "no-drag" };
type NavStyle = CSSProperties & { "--qp-active-nav-index"?: number };
const NO_DRAG_STYLE: AppRegionStyle = { WebkitAppRegion: "no-drag" };

export default function AppSidebar({
  currentView,
  onPrepareNavigate,
  onNavigate,
  onPreviewNavigate,
  footerContent,
  showUpdateEntry = false,
  onOpenUpdateDialog,
}: Props) {
  const navItems = [
    { id: "dashboard" as View, icon: Monitor, label: UI_TEXT.dashboard.title },
    { id: "history" as View, icon: Clock, label: UI_TEXT.history.title },
    { id: "data" as View, icon: BarChart3, label: UI_TEXT.data.title },
    { id: "mapping" as View, icon: Sparkles, label: UI_TEXT.mapping.title },
    { id: "tools" as View, icon: ToolCase, label: UI_TEXT.tools.title },
    { id: "settings" as View, icon: Settings2, label: UI_TEXT.settings.title },
    { id: "about" as View, icon: Info, label: UI_TEXT.about.title },
  ];
  const [optimisticView, setOptimisticView] = useState<View | null>(null);
  const navigateRequestRef = useRef(0);
  const cancelPendingNavigationRef = useRef<(() => void) | null>(null);
  const activeView = optimisticView ?? currentView;
  const activeNavIndex = navItems.findIndex((item) => item.id === activeView);
  const navStyle: NavStyle = {
    "--qp-active-nav-index": Math.max(0, activeNavIndex),
  };

  useEffect(() => {
    setOptimisticView(null);
  }, [currentView]);

  const handleNavClick = (view: View) => {
    cancelPendingNavigationRef.current?.();
    cancelPendingNavigationRef.current = null;
    navigateRequestRef.current += 1;
    const requestId = navigateRequestRef.current;

    const canNavigateImmediately = onPrepareNavigate?.(view) ?? true;
    if (canNavigateImmediately) {
      setOptimisticView(view);
    }

    const runNavigate = () => {
      if (navigateRequestRef.current !== requestId) return;

      void Promise.resolve(onNavigate(view)).then((navigated) => {
        if (navigateRequestRef.current !== requestId) return;
        if (navigated === false) {
          setOptimisticView(null);
        }
      });
    };

    // Prefer the next paint so optimistic feedback is visible before a heavy
    // page mount. A bounded timer keeps navigation correct when the browser or
    // WebView throttles animation frames while transitioning visibility.
    cancelPendingNavigationRef.current = scheduleNavigationCommit(() => {
      cancelPendingNavigationRef.current = null;
      runNavigate();
    });
  };

  useEffect(() => {
    return () => {
      cancelPendingNavigationRef.current?.();
      cancelPendingNavigationRef.current = null;
      navigateRequestRef.current += 1;
    };
  }, []);

  return (
    <aside
      className="qp-canvas w-[88px] md:w-[96px] shrink-0 flex flex-col items-center py-5 md:py-6 gap-5"
      style={NO_DRAG_STYLE}
    >
      <div className="w-10 h-10 rounded-[10px] flex items-center justify-center border border-[var(--qp-border-subtle)] bg-[var(--qp-bg-panel)]">
        <img src={appIconUrl} alt="" draggable={false} className="h-6 w-6 object-contain" />
      </div>

      <nav className="relative flex flex-col gap-2.5 mt-1 w-full px-2" style={navStyle}>
        {activeNavIndex >= 0 ? (
          <>
            <span className="qp-nav-active-bg pointer-events-none" />
            <span className="qp-nav-active-indicator pointer-events-none" />
          </>
        ) : null}
        {navItems.map((item) => {
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onFocus={() => onPreviewNavigate?.(item.id)}
              onMouseEnter={() => onPreviewNavigate?.(item.id)}
              onPointerDown={() => onPreviewNavigate?.(item.id)}
              onClick={() => handleNavClick(item.id)}
              aria-label={item.label}
              className={`qp-nav-item h-10 w-full rounded-[10px] transition-colors relative flex items-center justify-center ${
                isActive
                  ? "qp-nav-item-active"
                  : "text-[var(--qp-text-tertiary)] hover:text-[var(--qp-text-secondary)]"
              }`}
            >
              <span className="relative z-10 flex items-center justify-center">
                <item.icon size={18} strokeWidth={2.15} />
              </span>
            </button>
          );
        })}
      </nav>

      <div className="mt-auto flex w-full flex-col items-center gap-2 px-2">
        {footerContent}
        {showUpdateEntry ? (
          <button
            type="button"
            onClick={onOpenUpdateDialog}
            className="qp-chip flex h-7 w-[66px] items-center justify-center rounded-[8px] border border-[var(--qp-border-subtle)] bg-[var(--qp-bg-elevated)] px-0 text-[var(--qp-text-secondary)] transition-colors hover:border-[var(--qp-border-strong)] hover:bg-[var(--qp-bg-panel)] hover:text-[var(--qp-text-primary)] active:border-[var(--qp-border-strong)] active:bg-[var(--qp-bg-panel)]"
          >
            <span className="inline-flex w-full items-center justify-center gap-1 pl-px text-[10px] leading-none font-medium">
              <ArrowUpCircle size={11} strokeWidth={1.85} className="shrink-0" />
              <span className="block leading-none">{UI_TEXT.update.sidebarEntry}</span>
            </span>
          </button>
        ) : null}
      </div>
    </aside>
  );
}
