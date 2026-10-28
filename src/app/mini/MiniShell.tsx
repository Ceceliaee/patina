import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { AppWindow, Pin, SquareArrowOutUpRight, X } from "lucide-react";
import { LocaleProvider, useLocaleText } from "../../shared/i18n/index.ts";
import { showMainWindow } from "../../platform/desktop/windowControlGateway.ts";
import { useAppThemeMode } from "../hooks/useAppThemeMode.ts";
import { useMiniTracking } from "./useMiniTracking.ts";
import { useMiniWindow } from "./useMiniWindow.ts";
import MiniContent from "./MiniContent.tsx";
import { useMiniTransition } from "./useMiniTransition.ts";
import { buildMiniViewModel } from "./miniViewModel.ts";

export default function MiniShell() {
  const runtime = useMiniWindow();
  const tracking = useMiniTracking(Boolean(runtime.snapshot && (runtime.snapshot.expanded || runtime.snapshot.transitioning) && !runtime.snapshot.suppressed));
  useAppThemeMode(tracking.appSettings.themeMode, tracking.appSettings.colorSchemeLight, tracking.appSettings.colorSchemeDark);
  return <LocaleProvider locale={tracking.appSettings.language}>
    <MiniView runtime={runtime} tracking={tracking} />
  </LocaleProvider>;
}

function MiniView({ runtime, tracking }: {
  runtime: ReturnType<typeof useMiniWindow>;
  tracking: ReturnType<typeof useMiniTracking>;
}) {
  const text = useLocaleText();
  const view = buildMiniViewModel(tracking.activeWindow, tracking.trackingStatus, tracking.appSettings,
    tracking.trackerHealth, tracking.trackingRuntimeProbeStatus, text);
  const { snapshot, act, failed } = runtime;
  const [mainFailed, setMainFailed] = useState(false);
  const windowContainer = useRef<HTMLElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLButtonElement>(null);
  useMiniTransition(snapshot, panel, handle, act);
  const protection = useRef({ keyboard: false, touch: false });
  const drag = useRef<{ x: number; y: number; id: number } | null>(null);
  const dragged = useRef(false);
  const focusedRequest = useRef(0);
  const protect = (change: Partial<typeof protection.current>) => {
    protection.current = { ...protection.current, ...change };
    void act({ kind: "protect", menu: false, ...protection.current });
  };
  useEffect(() => {
    if (snapshot?.focusRequest && snapshot.expanded && focusedRequest.current !== snapshot.focusRequest) {
      focusedRequest.current = snapshot.focusRequest;
      windowContainer.current?.focus({ preventScroll: true });
      protection.current.keyboard = true;
    }
    // Hover revisions must never move DOM focus.
  }, [snapshot?.focusRequest, snapshot?.expanded]);
  useEffect(() => {
    if (snapshot?.suppressed || !snapshot?.expanded) {
      protection.current = { keyboard: false, touch: false };
      drag.current = null;
    }
  }, [snapshot?.suppressed, snapshot?.expanded]);
  useEffect(() => {
    const blur = () => { protection.current = { keyboard: false, touch: false }; };
    window.addEventListener("blur", blur);
    return () => window.removeEventListener("blur", blur);
  }, []);
  if (!snapshot) return failed ? <div className="mini-error" role="alert">{text.miniWindow.failed}</div> : null;
  const startPointer = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    drag.current = { x: event.screenX, y: event.screenY, id: event.pointerId };
    dragged.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const movePointer = (event: PointerEvent<HTMLElement>) => {
    const start = drag.current;
    if (!start || Math.hypot(event.screenX - start.x, event.screenY - start.y) < 4) return;
    drag.current = null; dragged.current = true;
    event.currentTarget.releasePointerCapture(start.id);
    void act({ kind: "begin_drag" });
  };
  const endPointer = () => { drag.current = null; };
  const dragProps = { onPointerDown: startPointer, onPointerMove: movePointer, onPointerUp: endPointer, onPointerCancel: endPointer };
  return <section ref={windowContainer} tabIndex={-1} className="mini-shell" data-expanded={snapshot?.expanded ?? false} data-edge={snapshot?.edge ?? "floating"}
    data-tone={tracking.miniStatus ? view.statusTone : "idle"}
    data-transitioning={snapshot?.transitioning ?? false}
    style={snapshot ? { "--mini-panel-width": `${snapshot.visual.width}px`, "--mini-panel-height": `${snapshot.visual.height}px`, "--mini-handle-anchor": snapshot.visual.anchor } as CSSProperties : undefined}
    aria-label={text.miniWindow.title}
    onKeyDownCapture={(event) => {
      protect({ keyboard: true });
      if (event.key === "Escape") {
        event.preventDefault();
        void act({ kind: "collapse" });
      }
    }}
    onPointerDownCapture={(event) => protect({ keyboard: false, touch: event.pointerType === "touch" })}
    onPointerMoveCapture={(event) => { if (event.pointerType === "mouse" && protection.current.keyboard) protect({ keyboard: false }); }}
    onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) protect({ keyboard: false }); }}>
    <span className="mini-status sr-only" role="status">{tracking.miniStatus ? view.statusLabel : ""}</span>
    <div ref={panel} className="mini-panel" inert={!snapshot?.expanded || snapshot.suppressed} aria-hidden={!snapshot?.expanded || snapshot.suppressed}>
      <div className="mini-panel-body">
      <header className="mini-header">
        <div className="mini-drag-region" {...dragProps}><AppWindow size={15} aria-hidden="true" /></div>
        <button type="button" className="qp-icon-action qp-icon-action-neutral" aria-label={text.accessibility.miniWindow.openMainWindow}
          onClick={() => { void showMainWindow().then(() => setMainFailed(false)).catch(() => setMainFailed(true)); }}><SquareArrowOutUpRight size={14} /></button>
        <button type="button" className="qp-icon-action qp-icon-action-neutral" aria-label={text.miniWindow.hold} aria-pressed={snapshot?.held ?? false}
          onClick={() => { void act({ kind: "hold", held: !snapshot?.held }); }}><Pin size={14} /></button>
        <button type="button" className="qp-icon-action app-titlebar-close" data-mini-close aria-label={text.accessibility.titleBar.close}
          onClick={() => { void act({ kind: "close" }); }}><X size={15} /></button>
      </header>
      {snapshot && (snapshot.expanded || snapshot.transitioning) && !snapshot.suppressed && tracking.presentationReady
        && <MiniContent tracking={tracking} />}
      </div>
    </div>
    <button ref={handle} type="button" className="mini-handle" inert={snapshot?.expanded ?? false} aria-hidden={snapshot?.expanded ?? false} aria-label={text.miniWindow.open} {...dragProps}
      onClick={() => { if (!dragged.current) void act({ kind: "reveal" }); }}><span aria-hidden="true" /></button>
    {(failed || mainFailed || snapshot?.failed) && <div className="mini-error" role="alert">{text.miniWindow.failed}</div>}
  </section>;
}
