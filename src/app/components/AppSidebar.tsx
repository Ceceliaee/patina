import type { CSSProperties, ReactNode } from "react";
import { motion } from "framer-motion";
import { ArrowUpCircle, Monitor, Clock, Settings2, Sparkles, BarChart3, Info, ToolCase } from "lucide-react";
import appIconUrl from "../../../src-tauri/icons/32x32.png";
import { UI_TEXT } from "../../shared/copy/index.ts";
import type { View } from "../types/view";

interface Props {
  currentView: View;
  onNavigate: (view: View) => void;
  footerContent?: ReactNode;
  showUpdateEntry?: boolean;
  onOpenUpdateDialog?: () => void;
}

type AppRegionStyle = CSSProperties & { WebkitAppRegion?: "drag" | "no-drag" };
const NO_DRAG_STYLE: AppRegionStyle = { WebkitAppRegion: "no-drag" };

export default function AppSidebar({
  currentView,
  onNavigate,
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

  return (
    <motion.aside
      initial={{ x: -4, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      className="qp-canvas w-[88px] md:w-[96px] shrink-0 flex flex-col items-center py-5 md:py-6 gap-5"
      style={NO_DRAG_STYLE}
    >
      <div className="w-10 h-10 rounded-[10px] flex items-center justify-center border border-[var(--qp-border-subtle)] bg-[var(--qp-bg-panel)]">
        <img src={appIconUrl} alt="" draggable={false} className="h-6 w-6 object-contain" />
      </div>

      <nav className="flex flex-col gap-2.5 mt-1 w-full px-2">
        {navItems.map((item) => {
          const isActive = currentView === item.id;
          return (
            <motion.button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              aria-label={item.label}
              className={`qp-nav-item h-10 w-full rounded-[10px] transition-colors relative flex items-center justify-center ${
                isActive
                  ? "qp-nav-item-active"
                  : "text-[var(--qp-text-tertiary)] hover:text-[var(--qp-text-secondary)]"
              }`}
            >
              {/* Sliding background highlight */}
              {isActive && (
                <motion.div
                  layoutId="active-nav-bg"
                  className="absolute inset-0 rounded-[10px] qp-nav-item-bg-slider pointer-events-none z-0"
                  transition={{
                    type: "spring",
                    stiffness: 380,
                    damping: 30,
                  }}
                />
              )}

              {/* Sliding vertical indicator pill */}
              {isActive && (
                <motion.div
                  layoutId="active-nav-indicator"
                  className="absolute left-[3px] top-[9px] w-[3px] h-[22px] rounded-full qp-nav-item-indicator-slider z-10 pointer-events-none"
                  transition={{
                    type: "spring",
                    stiffness: 350,
                    damping: 25,
                  }}
                />
              )}

              <span className="relative z-10 flex items-center justify-center">
                <item.icon size={18} strokeWidth={2.15} />
              </span>
            </motion.button>
          );
        })}
      </nav>

      <div className="mt-auto flex w-full flex-col items-center gap-2 px-2">
        {footerContent}
        {showUpdateEntry ? (
          <motion.button
            type="button"
            onClick={onOpenUpdateDialog}
            whileHover={{ x: 0.5 }}
            whileTap={{ scale: 0.995 }}
            transition={{ duration: 0.1, ease: "easeOut" }}
            className="qp-chip flex h-7 w-[66px] items-center justify-center rounded-[8px] border border-[var(--qp-border-subtle)] bg-[var(--qp-bg-elevated)] px-0 text-[var(--qp-text-secondary)] transition-colors hover:border-[var(--qp-border-strong)] hover:bg-[var(--qp-bg-panel)] hover:text-[var(--qp-text-primary)] active:border-[var(--qp-border-strong)] active:bg-[var(--qp-bg-panel)]"
          >
            <span className="inline-flex w-full items-center justify-center gap-1 pl-px text-[10px] leading-none font-medium">
              <ArrowUpCircle size={11} strokeWidth={1.85} className="shrink-0" />
              <span className="block leading-none">{UI_TEXT.update.sidebarEntry}</span>
            </span>
          </motion.button>
        ) : null}
      </div>
    </motion.aside>
  );
}
