import { useLocaleText } from "../../shared/i18n/index.ts";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { AppWindow, ArrowUpCircle, Maximize2, Minimize2, Minus, X } from "lucide-react";
import { openMiniWindow } from "../../platform/desktop/miniWindowRuntimeGateway.ts";
import appIconUrl from "../../../src-tauri/icons/128x128@2x.png";
import {
  closeCurrentWindow, minimizeCurrentWindow, startCurrentWindowDrag, toggleCurrentWindowMaximized, } from "../../platform/desktop/windowControlGateway";


const APP_TITLE = "Patina";

type AppTitleBarProps = {
  isMaximized: boolean;
  showUpdateEntry?: boolean;
  onOpenUpdateDialog?: () => void;
  toolsStatusEntry?: ReactNode;
};

function runWindowAction(action: () => Promise<void>, actionName: string) {
  void action().catch((error) => {
    console.warn(`${actionName} failed`, error);
  });
}

export default function AppTitleBar({
  isMaximized,
  showUpdateEntry = false,
  onOpenUpdateDialog,
  toolsStatusEntry,
}: AppTitleBarProps) {
  const UI_TEXT = useLocaleText();
  const [miniBusy, setMiniBusy] = useState(false);
  const [miniFailed, setMiniFailed] = useState(false);
  const openingMini = useRef(false);
  const miniEntry = useRef<HTMLButtonElement>(null);
  const restoreMiniFocus = useRef(false);
  useEffect(() => {
    if (miniBusy || !miniFailed || !restoreMiniFocus.current) return;
    restoreMiniFocus.current = false;
    if (document.activeElement === document.body) miniEntry.current?.focus({ preventScroll: true });
  }, [miniBusy, miniFailed]);
  const handleOpenMini = async () => {
    if (openingMini.current) return;
    openingMini.current = true;
    restoreMiniFocus.current = document.activeElement === miniEntry.current;
    setMiniBusy(true);
    setMiniFailed(false);
    try { await openMiniWindow(); }
    catch (error) { setMiniFailed(true); console.warn("mini:open", error); }
    finally { openingMini.current = false; setMiniBusy(false); }
  };
  const handleDragMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.detail > 1) {
      return;
    }

    runWindowAction(startCurrentWindowDrag, "start window drag");
  };

  const handleDragDoubleClick = () => {
    runWindowAction(toggleCurrentWindowMaximized, "toggle window maximize");
  };

  return (
    <header className="app-titlebar" aria-label={APP_TITLE}>
      <div className="app-titlebar-brand">
        <span className="app-titlebar-mark" aria-hidden>
          <img className="app-titlebar-icon" src={appIconUrl} alt="" draggable={false} />
        </span>
        <span className="app-titlebar-name">{APP_TITLE}</span>
      </div>

      {showUpdateEntry ? (
        <button
          type="button"
          className="app-titlebar-update-entry"
          data-titlebar-update-entry=""
          onClick={onOpenUpdateDialog}
        >
          <ArrowUpCircle size={12} strokeWidth={1.9} aria-hidden="true" />
          <span>{UI_TEXT.update.sidebarEntry}</span>
        </button>
      ) : null}

      <div
        className="app-titlebar-drag-region"
        onMouseDown={handleDragMouseDown}
        onDoubleClick={handleDragDoubleClick}
      />

      {toolsStatusEntry}

      <div className="app-titlebar-controls">
        <button ref={miniEntry} type="button" className="app-titlebar-button" data-titlebar-mini-entry=""
          aria-label={UI_TEXT.miniWindow.open} aria-busy={miniBusy} disabled={miniBusy}
          onClick={() => { void handleOpenMini(); }}><AppWindow size={14} strokeWidth={1.8} /></button>
        {miniFailed && <span className="app-titlebar-mini-error" role="alert">{UI_TEXT.miniWindow.failed}</span>}
        <button
          type="button"
          className="app-titlebar-button"
          aria-label={UI_TEXT.accessibility.titleBar.minimize}
          onClick={() => runWindowAction(minimizeCurrentWindow, "minimize current window")}
        >
          <Minus size={13} strokeWidth={2.1} />
        </button>
        <button
          type="button"
          className="app-titlebar-button"
          aria-label={isMaximized ? UI_TEXT.accessibility.titleBar.restore : UI_TEXT.accessibility.titleBar.maximize}
          onClick={() => runWindowAction(toggleCurrentWindowMaximized, "toggle window maximize")}
        >
          {isMaximized ? (
            <Minimize2 size={12} strokeWidth={2} />
          ) : (
            <Maximize2 size={12} strokeWidth={2} />
          )}
        </button>
        <button
          type="button"
          className="app-titlebar-button app-titlebar-close"
          aria-label={UI_TEXT.accessibility.titleBar.close}
          onClick={() => runWindowAction(closeCurrentWindow, "close current window")}
        >
          <X size={13} strokeWidth={2.1} />
        </button>
      </div>
    </header>
  );
}
