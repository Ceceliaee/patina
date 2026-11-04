import { useEffect, useMemo, useRef, useState } from "react";
import { AppWindow, Check, Globe, Layers } from "lucide-react";
import QuietButton from "../../../shared/components/QuietButton.tsx";
import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import { useRequestedAppIcons } from "../../../shared/hooks/useRequestedAppIcons.ts";
import type { ActivityReminderAlert, ActivityReminderExtension, ToolAlert } from "../../../shared/types/tools.ts";
import { loadToolsIconsForExecutables } from "../services/toolsRuntimeService.ts";
import { loadActivityReminderWebCandidates } from "../services/activityReminderTargetCandidates.ts";
import { ToolsRuntimeService } from "../services/toolsRuntimeService.ts";
import type { ToolAlertActions } from "../../../shared/types/toolNotifications.ts";
import { formatUsageDuration } from "../services/toolsLabels.ts";

const EMPTY_ICONS: Record<string, string> = {};

export default function ActivityReminderAlertDialog({ details, onAction, notification = false, targetIcon: assignedIcon }: {
  alert: ToolAlert;
  details: ActivityReminderAlert;
  notification?: boolean;
  targetIcon?: string | null;
} & ToolAlertActions) {
  const text = useLocaleText();
  const locale = useLocale();
  const [step, setStep] = useState<"limit" | "extend">("limit");
  const [extension, setExtension] = useState<ActivityReminderExtension>("fifteen_minutes");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const extendRef = useRef<HTMLButtonElement>(null);
  const desktopRef = useRef<HTMLButtonElement>(null);
  const selectedRef = useRef<HTMLInputElement>(null);
  const [favicon, setFavicon] = useState<string | null>(null);
  const exe = !notification && details.target.kind === "app" ? details.target.exeName : null;
  const exeNames = useMemo(() => [exe], [exe]);
  const icons = useRequestedAppIcons({ baseIcons: EMPTY_ICONS, exeNames, loadIcons: loadToolsIconsForExecutables });
  const domain = !notification && details.target.kind === "web" ? details.target.normalizedDomain : null;
  useEffect(() => {
    if (!domain) return;
    let disposed = false;
    void loadActivityReminderWebCandidates().then(candidates => {
      if (!disposed) setFavicon(candidates.find(candidate => candidate.normalizedDomain === domain)?.faviconUrl ?? null);
    }).catch(() => {});
    return () => { disposed = true; };
  }, [domain]);
  useEffect(() => {
    if (step === "extend") selectedRef.current?.focus();
  }, [step]);

  const duration = (ms: number) => formatUsageDuration(ms / 60_000, locale);
  const icon = assignedIcon || (exe && (icons[exe] ?? icons[exe.toLowerCase()])) || favicon;
  const targetIcon = icon ? <img src={icon} alt="" draggable={false} />
    : details.target.kind === "category" ? <Layers size={28} />
      : details.target.kind === "web" ? <Globe size={28} /> : <AppWindow size={28} />;
  const cancelExtension = () => {
    if (busyRef.current) return;
    setStep("limit"); setError(null);
    requestAnimationFrame(() => extendRef.current?.focus());
  };
  const act = async (action: "extend" | "desktop" | "dismiss") => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(null);
    try {
      await onAction(action === "extend" ? { kind: "extend", extension } : { kind: action });
    } catch (cause) {
      setError(ToolsRuntimeService.isStateRefreshPendingError(cause) ? text.tools.stateRefreshPending : text.tools.actionFailed);
    } finally {
      busyRef.current = false; setBusy(false);
    }
  };
  const choices: Array<{ value: ActivityReminderExtension; label: string }> = [
    { value: "fifteen_minutes", label: text.tools.usageExtendFifteen },
    { value: "one_hour", label: text.tools.usageExtendHour },
    { value: "today", label: text.tools.usageExtendToday },
  ];

  return <QuietDialog
    open
    autoFocus={!notification}
    title={step === "extend" ? text.tools.usageExtendTitle(details.targetLabel) : <>
      <span className="tools-usage-alert-identity"><span className="tools-usage-alert-icon" aria-hidden>{targetIcon}</span>
        <span className="tools-usage-alert-name">{details.targetLabel}</span></span>
      <span>{text.tools.usageLimitReached}</span>
    </>}
    surfaceClassName={`tools-usage-alert-surface tools-usage-alert-${step}`}
    closeOnBackdrop={false}
    initialFocusRef={desktopRef}
    onClose={() => { if (!busyRef.current) { if (step === "extend") cancelExtension(); else void act("dismiss"); } }}
    actions={step === "limit" ? <>
      <QuietButton ref={extendRef} size="large" disabled={busy} onClick={() => { setExtension("fifteen_minutes"); setStep("extend"); setError(null); }}>{text.tools.usageExtend}</QuietButton>
      <QuietButton ref={desktopRef} tone="primary" size="large" busy={busy} onClick={() => void act("desktop")}>{text.tools.usageReturnDesktop}</QuietButton>
    </> : <>
      <QuietButton size="large" disabled={busy} onClick={cancelExtension}>{text.common.cancel}</QuietButton>
      <QuietButton tone="primary" size="large" busy={busy} onClick={() => void act("extend")}>{text.common.confirm}</QuietButton>
    </>}
  >
    {step === "limit" ? <p className="tools-usage-alert-summary">{text.tools.usageLimitSummary(duration(details.usageMs))}</p> : null}
    {step === "extend" ?
      <fieldset className="tools-usage-alert-options" aria-label={text.tools.usageExtensionDuration} disabled={busy}>
        {choices.map(choice => <label key={choice.value} className="tools-usage-alert-option">
          <span>{choice.label}</span>
          <input ref={choice.value === extension ? selectedRef : undefined} type="radio" name="usage-extension" value={choice.value} checked={extension === choice.value} onChange={() => setExtension(choice.value)} />
          <Check className="tools-usage-alert-option-check" size={18} aria-hidden />
        </label>)}
      </fieldset>
      : null}
    {error ? <p className="tools-usage-alert-error" role="alert">{error}</p> : null}
  </QuietDialog>;
}
