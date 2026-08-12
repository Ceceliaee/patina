import { useLocaleText } from "../../shared/i18n/index.ts";
import QuietIconAction from "../../shared/components/QuietIconAction";
import { useEffect, useRef, type CSSProperties } from "react";
import { Monitor, Clock, Settings2, Sparkles, BarChart3, Info, Menu, ToolCase } from "lucide-react";
import appIconUrl from "../../../src-tauri/icons/128x128@2x.png";

import type { SidebarNavigationMode } from "../services/sidebarNavigationPreferenceStorage.ts";
import type { View } from "../types/view";

export interface AppSidebarProps {
  currentView: View;
  navigationMode: SidebarNavigationMode;
  onNavigationModeToggle: () => void;
  onPrepareNavigate?: (view: View) => boolean;
  onNavigate: (view: View) => boolean | void | Promise<boolean | void>;
  onPreviewNavigate?: (view: View) => void;
}

type AppRegionStyle = CSSProperties & { WebkitAppRegion?: "drag" | "no-drag" };
type NavStyle = CSSProperties & { "--qp-active-nav-index"?: number };
const NO_DRAG_STYLE: AppRegionStyle = { WebkitAppRegion: "no-drag" };

export default function AppSidebar({
  currentView,
  navigationMode,
  onNavigationModeToggle,
  onPrepareNavigate,
  onNavigate,
  onPreviewNavigate,
}: AppSidebarProps) {
  const UI_TEXT = useLocaleText();
  const isLabeled = navigationMode === "labeled";
  const navItems = [
    { id: "dashboard" as View, icon: Monitor, label: UI_TEXT.dashboard.title },
    { id: "history" as View, icon: Clock, label: UI_TEXT.history.title },
    { id: "data" as View, icon: BarChart3, label: UI_TEXT.data.title },
    { id: "mapping" as View, icon: Sparkles, label: UI_TEXT.mapping.title },
    { id: "tools" as View, icon: ToolCase, label: UI_TEXT.tools.title },
    { id: "settings" as View, icon: Settings2, label: UI_TEXT.settings.title },
    { id: "about" as View, icon: Info, label: UI_TEXT.about.title },
  ];
  const navigateRequestRef = useRef(0);
  const activeView = currentView;
  const activeNavIndex = navItems.findIndex((item) => item.id === activeView);
  const navStyle: NavStyle = {
    "--qp-active-nav-index": Math.max(0, activeNavIndex),
  };

  const handleNavClick = (view: View) => {
    navigateRequestRef.current += 1;
    const requestId = navigateRequestRef.current;

    onPrepareNavigate?.(view);

    const runNavigate = () => {
      if (navigateRequestRef.current !== requestId) return;
      void Promise.resolve(onNavigate(view));
    };

    // Navigation correctness must not depend on an animation frame or timer:
    // background and headless WebViews may throttle both. AppShell keeps the
    // previous rendered view until the destination chunk is ready, so the
    // accepted state transition remains cheap and can commit immediately.
    runNavigate();
  };

  useEffect(() => {
    return () => {
      navigateRequestRef.current += 1;
    };
  }, []);

  return (
    <aside
      className="qp-canvas w-[88px] md:w-[96px] shrink-0 flex flex-col items-center py-5 md:py-6 gap-5"
      data-sidebar-navigation-mode={navigationMode}
      style={NO_DRAG_STYLE}
    >
      <div className="w-10 h-10 rounded-[10px] flex items-center justify-center border border-[var(--qp-border-subtle)] bg-[var(--qp-bg-panel)]">
        <img src={appIconUrl} alt="" draggable={false} className="h-6 w-6 object-contain" />
      </div>

      <nav
        className="relative flex flex-col gap-2.5 mt-1 w-full px-2"
        data-sidebar-primary-nav=""
        style={navStyle}
      >
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
              aria-current={isActive ? "page" : undefined}
              data-sidebar-nav-item={item.id}
              className={`qp-nav-item h-10 w-full rounded-[10px] transition-colors relative flex items-center justify-center ${
                isActive
                  ? "qp-nav-item-active"
                  : "text-[var(--qp-text-tertiary)] hover:text-[var(--qp-text-secondary)]"
              }`}
            >
              <span
                className={`qp-nav-item-content relative z-10 ${isLabeled ? "qp-nav-item-content-labeled" : ""}`.trim()}
              >
                <item.icon size={isLabeled ? 15 : 18} strokeWidth={2.15} />
                {isLabeled ? (
                  <span className="qp-nav-item-label" data-sidebar-nav-label="" aria-hidden="true">
                    {item.label}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="mt-auto flex w-full flex-col items-center gap-1 px-2" data-sidebar-footer="">
        <QuietIconAction
          icon={<Menu size={16} strokeWidth={1.9} />}
          title={UI_TEXT.accessibility.sidebar.navigationLabels}
          ariaLabel={UI_TEXT.accessibility.sidebar.navigationLabels}
          pressed={isLabeled}
          showPressedStyle={false}
          showTooltip={false}
          onClick={onNavigationModeToggle}
        />
      </div>
    </aside>
  );
}
