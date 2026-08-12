import { useLocaleText } from "../../shared/i18n/index.ts";
import { type MouseEvent, type ReactNode } from "react";
import { ArrowUpCircle, Maximize2, Minimize2, Minus, X } from "lucide-react";
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
