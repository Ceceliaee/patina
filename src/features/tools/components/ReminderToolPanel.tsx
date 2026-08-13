import { BellRing, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import QuietButton from "../../../shared/components/QuietButton.tsx";
import QuietDatePicker from "../../../shared/components/QuietDatePicker.tsx";
import QuietSegmentedFilter from "../../../shared/components/QuietSegmentedFilter.tsx";
import QuietTimePicker from "../../../shared/components/QuietTimePicker.tsx";
import { useLocaleText } from "../../../shared/i18n/index.ts";
import type {
  ActivityReminderAppCandidate,
  ActivityReminderCategoryCandidate,
  ActivityReminderTarget,
  ActivityReminderWebCandidate,
} from "../../../shared/types/tools.ts";
import {
  readToolsReminderFormMode,
  readToolsReminderMode,
  rememberToolsReminderFormMode,
  rememberToolsReminderMode,
} from "../services/toolsLayoutPreferenceStorage.ts";
import { formatMinuteInput, parseBoundedMinuteInput } from "../services/toolsNumberInput.ts";
import type {
  ActivityReminderRuleRowViewModel,
  ReminderFormMode,
  ReminderMode,
  ReminderRowViewModel,
} from "../types.ts";
import ActivityReminderTargetPicker from "./ActivityReminderTargetPicker.tsx";

interface ReminderToolPanelProps {
  reminderRows: ReminderRowViewModel[];
  activityReminderRuleRows: ActivityReminderRuleRowViewModel[];
  activityReminderAppCandidates: ActivityReminderAppCandidate[];
  activityReminderCategoryCandidates: ActivityReminderCategoryCandidate[];
  activityReminderWebCandidates: ActivityReminderWebCandidate[];
  icons: Record<string, string>;
  busyAction: string | null;
  onCreateReminder: (label: string, scheduledAt: number) => Promise<boolean>;
  onCancelReminder: (id: number) => Promise<void>;
  onCreateActivityReminderRule: (
    target: ActivityReminderTarget,
    labelSnapshot: string,
    limitMinutes: number,
    message: string,
  ) => Promise<boolean>;
  onDisableActivityReminderRule: (id: number) => Promise<void>;
  onActivityModeActivated: (mode: Exclude<ReminderMode, "event">) => Promise<void>;
  activityReminderCandidateRevision: number;
  activityReminderCandidateLoadState: Record<Exclude<ReminderMode, "event">, "idle" | "loading" | "ready" | "error">;
  onRetryActivityReminderCandidates: (mode: Exclude<ReminderMode, "event">) => void;
}

interface ActivityReminderPanelProps {
  mode: Exclude<ReminderMode, "event">;
  ruleRows: ActivityReminderRuleRowViewModel[];
  appCandidates: ActivityReminderAppCandidate[];
  categoryCandidates: ActivityReminderCategoryCandidate[];
  webCandidates: ActivityReminderWebCandidate[];
  icons: Record<string, string>;
  busyAction: string | null;
  onCreateRule: ReminderToolPanelProps["onCreateActivityReminderRule"];
  onDisableRule: ReminderToolPanelProps["onDisableActivityReminderRule"];
  draft: ActivityReminderDraft;
  onDraftChange: (patch: Partial<ActivityReminderDraft>) => void;
  candidateLoadState: "idle" | "loading" | "ready" | "error";
  onRetryCandidates: () => void;
}

interface ActivityReminderDraft {
  targetValue: string;
  durationMinutes: string;
  message: string;
  validationMessage: string | null;
}

const EMPTY_ACTIVITY_DRAFT: ActivityReminderDraft = {
  targetValue: "",
  durationMinutes: "30",
  message: "",
  validationMessage: null,
};

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function toDateInputValue(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function toTimeInputValue(date: Date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function parseLocalDateTime(dateValue: string, timeValue: string) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
    || date.getHours() !== hour
    || date.getMinutes() !== minute
  ) return null;
  return date.getTime();
}

function appInitial(label: string) {
  return label.trim().slice(0, 1).toUpperCase() || "?";
}

function resolveAppIcon(icons: Record<string, string>, exeName: string | null) {
  if (!exeName) return null;
  return icons[exeName] ?? icons[exeName.toLocaleLowerCase()] ?? null;
}

function ActivityReminderPanel({
  mode,
  ruleRows,
  appCandidates,
  categoryCandidates,
  webCandidates,
  icons,
  busyAction,
  onCreateRule,
  onDisableRule,
  draft,
  onDraftChange,
  candidateLoadState,
  onRetryCandidates,
}: ActivityReminderPanelProps) {
  const UI_TEXT = useLocaleText();
  const { targetValue, durationMinutes, message, validationMessage } = draft;
  const updateDraft = (patch: Partial<ActivityReminderDraft>) => {
    onDraftChange(patch);
  };
  const creating = busyAction === "create-activity-reminder";
  const activeRows = ruleRows.filter((row) => row.kind === mode);

  const selectedTarget = useMemo((): { target: ActivityReminderTarget; label: string } | null => {
    if (mode === "app") {
      const normalized = targetValue.trim().toLocaleLowerCase();
      const candidate = appCandidates.find((item) => (
        item.exeName.toLocaleLowerCase() === normalized
        || item.appName.toLocaleLowerCase() === normalized
        || `${item.appName} (${item.exeName})`.toLocaleLowerCase() === normalized
      ));
      return candidate ? {
        target: { kind: "app", appName: candidate.appName, exeName: candidate.exeName },
        label: candidate.appName,
      } : null;
    }
    if (mode === "category") {
      const candidate = categoryCandidates.find((item) => item.categoryId === targetValue);
      return candidate ? {
        target: { kind: "category", categoryId: candidate.categoryId },
        label: candidate.label,
      } : null;
    }
    const normalized = targetValue.trim().replace(/\.$/, "").toLocaleLowerCase();
    const candidate = webCandidates.find((item) => (
      item.normalizedDomain === normalized || item.label.toLocaleLowerCase() === normalized
    ));
    return candidate ? {
      target: { kind: "web", normalizedDomain: candidate.normalizedDomain },
      label: candidate.label,
    } : null;
  }, [appCandidates, categoryCandidates, mode, targetValue, webCandidates]);

  const handleCreate = async () => {
    const limitMinutes = Number(durationMinutes);
    if (!selectedTarget) {
      updateDraft({ validationMessage: UI_TEXT.tools.activityReminderTargetRequired });
      return;
    }
    if (!Number.isFinite(limitMinutes) || limitMinutes < 1 || limitMinutes > 1440) {
      updateDraft({ validationMessage: UI_TEXT.tools.activityReminderDurationInvalid });
      return;
    }
    updateDraft({ validationMessage: null });
    const created = await onCreateRule(
      selectedTarget.target,
      selectedTarget.label,
      Math.round(limitMinutes),
      message.trim(),
    );
    if (created) {
      updateDraft({ targetValue: "", message: "", validationMessage: null });
    }
  };

  const targetPlaceholder = mode === "app"
    ? UI_TEXT.tools.activityReminderAppPlaceholder
    : mode === "category"
      ? UI_TEXT.tools.activityReminderCategoryPlaceholder
      : UI_TEXT.tools.activityReminderWebPlaceholder;
  const targetLabel = mode === "app"
    ? UI_TEXT.tools.reminderModeApp
    : mode === "category"
      ? UI_TEXT.tools.reminderModeCategory
      : UI_TEXT.tools.reminderModeWeb;

  return (
    <>
      <div className="tools-subpanel">
        <div className="tools-subpanel-header tools-reminder-subpanel-header">
          <h3>{UI_TEXT.tools.newReminder}</h3>
        </div>
        <div className="tools-reminder-form tools-software-reminder-form">
          <div className="tools-form-field">
            <span>{targetLabel}</span>
            <ActivityReminderTargetPicker
              mode={mode}
              value={targetValue}
              appCandidates={appCandidates}
              categoryCandidates={categoryCandidates}
              webCandidates={webCandidates}
              icons={icons}
              placeholder={targetPlaceholder}
              ariaLabel={targetPlaceholder}
              onChange={(value) => {
                updateDraft({ targetValue: value, validationMessage: null });
              }}
            />
          </div>
          {candidateLoadState === "error" ? (
            <div className="tools-candidate-load-error" role="status">
              <span>{UI_TEXT.tools.activityReminderCandidatesLoadFailed}</span>
              <QuietButton size="compact" onClick={onRetryCandidates}>
                {UI_TEXT.tools.retry}
              </QuietButton>
            </div>
          ) : null}
          <label className="tools-form-field">
            <span>{UI_TEXT.tools.activityReminderDurationLabel}</span>
            <input
              type="number"
              min={1}
              max={1440}
              value={durationMinutes}
              onChange={(event) => updateDraft({ durationMinutes: event.target.value })}
              className="qp-input tools-small-number-input"
            />
          </label>
          <label className="tools-form-field">
            <span>{UI_TEXT.tools.activityReminderMessageLabel}</span>
            <input
              type="text"
              value={message}
              onChange={(event) => updateDraft({ message: event.target.value })}
              placeholder={UI_TEXT.tools.activityReminderMessagePlaceholder}
              className="qp-input"
            />
          </label>
          <div className="tools-form-actions tools-software-form-actions">
            <QuietButton
              tone="primary"
              size="large"
              disabled={creating}
              onClick={() => void handleCreate()}
              aria-label={UI_TEXT.accessibility.tools.createReminder}
              busy={creating}
              className="tools-action-button"
            >
              <Plus size={14} />
              {UI_TEXT.tools.createReminder}
            </QuietButton>
          </div>
          {validationMessage ? <p className="tools-validation-message">{validationMessage}</p> : null}
        </div>
      </div>

      <div className="tools-list-section tools-reminder-list-section">
        <h3>{UI_TEXT.tools.activityReminderRulesTitle}</h3>
        {activeRows.length === 0 ? (
          <div className="tools-empty-state">{UI_TEXT.tools.activityReminderEmpty}</div>
        ) : (
          <div className="tools-reminder-list tools-software-rule-list qp-scroll-region">
            {activeRows.map((row) => {
              const disabling = busyAction === `disable-activity-reminder:${row.id}`;
              const icon = row.kind === "app" ? resolveAppIcon(icons, row.exeName) : null;
              const webCandidate = row.kind === "web"
                ? webCandidates.find((candidate) => candidate.normalizedDomain === row.targetKey)
                : null;
              const category = row.kind === "category"
                ? categoryCandidates.find((candidate) => candidate.categoryId === row.targetKey)
                : null;
              const appCandidate = row.kind === "app"
                ? appCandidates.find((candidate) => candidate.exeName === row.targetKey)
                : null;
              const currentLabel = appCandidate?.appName
                ?? category?.label
                ?? webCandidate?.label
                ?? row.targetLabel;
              const suspensionLabel = row.suspensionReason
                ? UI_TEXT.tools.activityReminderSuspension[row.suspensionReason]
                : row.statusLabel;
              return (
                <div key={row.id} className="tools-reminder-row">
                  <div className="tools-reminder-row-main tools-software-rule-main">
                    <span
                      className="data-app-option-icon"
                      data-activity-category-marker={category ? "" : undefined}
                      aria-hidden
                      style={category ? {
                        "--activity-category-color": category.color,
                      } as CSSProperties : undefined}
                    >
                      {category ? (
                        <span className="tools-activity-category-dot" />
                      ) : icon || webCandidate?.faviconUrl ? (
                        <img src={icon ?? webCandidate?.faviconUrl ?? undefined} alt="" draggable={false} />
                      ) : appInitial(currentLabel)}
                    </span>
                    <div className="tools-software-rule-copy">
                      <strong>{currentLabel}</strong>
                      <span>{row.message}</span>
                    </div>
                  </div>
                  <div className="tools-reminder-row-meta">
                    <span className="tools-status-pill tools-status-scheduled">{suspensionLabel}</span>
                    <span className="tools-tabular">{row.limitLabel}</span>
                    <button
                      type="button"
                      disabled={disabling}
                      aria-label={`${UI_TEXT.tools.activityReminderDisable}: ${currentLabel}`}
                      onClick={() => void onDisableRule(row.id)}
                      className="qp-button-secondary tools-icon-button"
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

export default function ReminderToolPanel({
  reminderRows,
  activityReminderRuleRows,
  activityReminderAppCandidates,
  activityReminderCategoryCandidates,
  activityReminderWebCandidates,
  icons,
  busyAction,
  onCreateReminder,
  onCancelReminder,
  onCreateActivityReminderRule,
  onDisableActivityReminderRule,
  onActivityModeActivated,
  activityReminderCandidateRevision,
  activityReminderCandidateLoadState,
  onRetryActivityReminderCandidates,
}: ReminderToolPanelProps) {
  const UI_TEXT = useLocaleText();
  const [reminderMode, setReminderMode] = useState<ReminderMode>(readToolsReminderMode);
  const [mode, setMode] = useState<ReminderFormMode>(readToolsReminderFormMode);
  const [label, setLabel] = useState("");
  const [relativeMinutes, setRelativeMinutes] = useState(() => formatMinuteInput(15));
  const [absoluteDate, setAbsoluteDate] = useState(() => toDateInputValue(new Date()));
  const [absoluteTime, setAbsoluteTime] = useState(() => toTimeInputValue(new Date()));
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [activityDrafts, setActivityDrafts] = useState<Record<Exclude<ReminderMode, "event">, ActivityReminderDraft>>({
    app: { ...EMPTY_ACTIVITY_DRAFT },
    category: { ...EMPTY_ACTIVITY_DRAFT },
    web: { ...EMPTY_ACTIVITY_DRAFT },
  });
  const scheduledRows = reminderRows.filter((row) => row.status === "scheduled");
  const creating = busyAction === "create-reminder";
  const reminderModes = [
    { value: "event" as const, label: UI_TEXT.tools.reminderModeEvent },
    { value: "app" as const, label: UI_TEXT.tools.reminderModeApp },
    { value: "category" as const, label: UI_TEXT.tools.reminderModeCategory },
    { value: "web" as const, label: UI_TEXT.tools.reminderModeWeb },
  ];
  const formModes = [
    { value: "relative" as const, label: UI_TEXT.tools.reminderModeRelative },
    { value: "absolute" as const, label: UI_TEXT.tools.reminderModeAbsolute },
  ];

  useEffect(() => {
    if (reminderMode !== "event" || mode !== "absolute") return undefined;
    let refreshTimeout: number | null = null;
    const refreshNow = () => {
      const nextNowMs = Date.now();
      setNowMs(nextNowMs);
      refreshTimeout = window.setTimeout(refreshNow, 60_000 - (nextNowMs % 60_000) + 25);
    };
    refreshNow();
    return () => {
      if (refreshTimeout !== null) window.clearTimeout(refreshTimeout);
    };
  }, [mode, reminderMode]);

  useEffect(() => {
    if (reminderMode !== "event") {
      void onActivityModeActivated(reminderMode);
    }
  }, [activityReminderCandidateRevision, onActivityModeActivated, reminderMode]);

  const handleReminderModeChange = (nextMode: ReminderMode) => {
    setReminderMode(nextMode);
    rememberToolsReminderMode(nextMode);
  };
  const handleModeChange = (nextMode: ReminderFormMode) => {
    if (nextMode === "absolute" && mode !== "absolute") {
      const now = new Date();
      setAbsoluteDate(toDateInputValue(now));
      setAbsoluteTime(toTimeInputValue(now));
    }
    setNowMs(Date.now());
    setMode(nextMode);
    rememberToolsReminderFormMode(nextMode);
  };
  const resolveScheduledAt = () => {
    if (mode === "relative") {
      const minutes = parseBoundedMinuteInput(relativeMinutes, 1, 1440);
      return minutes === null ? null : Date.now() + minutes * 60_000;
    }
    return parseLocalDateTime(absoluteDate, absoluteTime);
  };
  const scheduledAt = resolveScheduledAt();
  const canCreateReminder = scheduledAt !== null && scheduledAt > nowMs;
  const handleCreate = async () => {
    const nextScheduledAt = resolveScheduledAt();
    if (nextScheduledAt === null || nextScheduledAt <= Date.now()) return;
    const created = await onCreateReminder(
      label.trim() || UI_TEXT.tools.defaultReminderLabel,
      nextScheduledAt,
    );
    if (created) setLabel("");
  };

  return (
    <section className="tools-panel qp-panel">
      <div className="tools-panel-header">
        <div className="tools-panel-title">
          <BellRing size={16} />
          <h2>{UI_TEXT.tools.remindersTitle}</h2>
        </div>
      </div>
      <div className="tools-mode-pane" data-tools-reminder-mode={reminderMode}>
        <div className="tools-mode-switch-row">
          <QuietSegmentedFilter
            value={reminderMode}
            options={reminderModes}
            onChange={handleReminderModeChange}
            className="tools-reminder-kind-filter"
            semantics="tabs"
            ariaLabel={UI_TEXT.tools.remindersTitle}
            tabIdPrefix="tools-reminder-mode-tab"
            tabPanelId="tools-reminder-mode-panel"
          />
        </div>
        <div
          id="tools-reminder-mode-panel"
          role="tabpanel"
          aria-labelledby={`tools-reminder-mode-tab-${reminderMode}`}
          className="tools-mode-content-pane"
        >
          {reminderMode === "event" ? (
            <>
              <div className="tools-subpanel">
                <div className="tools-subpanel-header tools-reminder-subpanel-header">
                  <h3>{UI_TEXT.tools.newReminder}</h3>
                  <QuietSegmentedFilter
                    value={mode}
                    options={formModes}
                    onChange={handleModeChange}
                    className="tools-reminder-time-filter"
                  />
                </div>
                <div className="tools-reminder-form">
                  <label className="tools-form-field">
                    <span>{UI_TEXT.tools.reminderLabel}</span>
                    <input
                      type="text"
                      value={label}
                      onChange={(event) => setLabel(event.target.value)}
                      placeholder={UI_TEXT.tools.reminderLabelPlaceholder}
                      className="qp-input"
                    />
                  </label>
                  {mode === "relative" ? (
                    <div className="tools-form-field">
                      <span>{UI_TEXT.tools.relativeMinutesLabel}</span>
                      <input
                        type="number"
                        min={1}
                        max={1440}
                        value={relativeMinutes}
                        onChange={(event) => setRelativeMinutes(event.target.value)}
                        className="qp-input tools-small-number-input"
                      />
                    </div>
                  ) : (
                    <div className="tools-absolute-time-grid">
                      <div className="tools-form-field">
                        <span>{UI_TEXT.tools.absoluteDateLabel}</span>
                        <QuietDatePicker value={absoluteDate} onChange={setAbsoluteDate} ariaLabel={UI_TEXT.date.pickDate} />
                      </div>
                      <div className="tools-form-field">
                        <span>{UI_TEXT.tools.absoluteTimeLabel}</span>
                        <QuietTimePicker value={absoluteTime} onChange={setAbsoluteTime} ariaLabel={UI_TEXT.time.pickTime} />
                      </div>
                    </div>
                  )}
                  <div className="tools-form-actions">
                    <QuietButton
                      tone="primary"
                      size="large"
                      disabled={creating || !canCreateReminder}
                      onClick={() => void handleCreate()}
                      aria-label={UI_TEXT.accessibility.tools.createReminder}
                      busy={creating}
                      className="tools-action-button"
                    >
                      <Plus size={14} />
                      {UI_TEXT.tools.createReminder}
                    </QuietButton>
                  </div>
                </div>
              </div>
              <div className="tools-list-section tools-reminder-list-section">
                <h3>{UI_TEXT.tools.pendingReminders}</h3>
                {scheduledRows.length === 0 ? (
                  <div className="tools-empty-state">{UI_TEXT.tools.reminderEmpty}</div>
                ) : (
                  <div className="tools-reminder-list qp-scroll-region">
                    {scheduledRows.map((row) => {
                      const cancelling = busyAction === `cancel-reminder:${row.id}`;
                      return (
                        <div key={row.id} className="tools-reminder-row">
                          <div className="tools-reminder-row-main">
                            <strong>{row.label}</strong>
                            <span>{row.dueLabel}</span>
                          </div>
                          <div className="tools-reminder-row-meta">
                            <span className={`tools-status-pill tools-status-${row.status}`}>
                              {UI_TEXT.tools.reminderStatus[row.status]}
                            </span>
                            <span className="tools-tabular">{row.remainingLabel}</span>
                            {row.canCancel ? (
                              <button
                                type="button"
                                disabled={cancelling}
                                aria-label={UI_TEXT.accessibility.tools.cancelReminder}
                                onClick={() => void onCancelReminder(row.id)}
                                className="qp-button-secondary tools-icon-button"
                              >
                                <X size={12} />
                              </button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          ) : (
            <ActivityReminderPanel
              mode={reminderMode}
              ruleRows={activityReminderRuleRows}
              appCandidates={activityReminderAppCandidates}
              categoryCandidates={activityReminderCategoryCandidates}
              webCandidates={activityReminderWebCandidates}
              icons={icons}
              busyAction={busyAction}
              onCreateRule={onCreateActivityReminderRule}
              onDisableRule={onDisableActivityReminderRule}
              draft={activityDrafts[reminderMode]}
              onDraftChange={(patch) => {
                setActivityDrafts((current) => ({
                  ...current,
                  [reminderMode]: { ...current[reminderMode], ...patch },
                }));
              }}
              candidateLoadState={activityReminderCandidateLoadState[reminderMode]}
              onRetryCandidates={() => onRetryActivityReminderCandidates(reminderMode)}
            />
          )}
        </div>
      </div>
    </section>
  );
}
