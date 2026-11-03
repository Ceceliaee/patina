import { BellRing, Repeat, ClipboardCheck, PencilLine, ToggleLeft, ToggleRight, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import QuietIconAction from "../../../shared/components/QuietIconAction.tsx";
import QuietTooltip from "../../../shared/components/QuietTooltip.tsx";
import ReminderScheduleFields, { recurrenceLabel, validRecurrence } from "./ReminderScheduleFields.tsx";
import TimedReminderEditor from "./TimedReminderEditor.tsx";
import { toDateInputValue, toTimeInputValue, parseLocalDateTime } from "../services/reminderTimeInput.ts";
import ActivityReminderRuleEditor from "./ActivityReminderRuleEditor.tsx";
import ActivityReminderDurationPicker from "./ActivityReminderDurationPicker.tsx";
import QuietButton from "../../../shared/components/QuietButton.tsx";
import QuietSegmentedFilter from "../../../shared/components/QuietSegmentedFilter.tsx";
import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import type {
  ReminderRecurrence,
  ActivityReminderAppCandidate,
  ActivityReminderCategoryCandidate,
  ActivityReminderTarget,
  ActivityReminderWebCandidate,
} from "../../../shared/types/tools.ts";
import {
  readToolsReminderMode,
  rememberToolsReminderMode,
} from "../services/toolsLayoutPreferenceStorage.ts";
import {
  buildActivityReminderTargetOptions,
  findActivityReminderRuleForTarget,
  findActivityReminderTargetOption,
} from "../services/activityReminderTargetOptions.ts";
import type {
  ActivityReminderRuleRowViewModel,
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
  onCreateReminder: (label: string, scheduledAt: number, recurrence: ReminderRecurrence | null) => Promise<boolean>;
  onCancelReminder: (id: number) => Promise<void>;
  onUpdateReminder: (id: number, label: string, scheduledAt: number, enabled: boolean, recurrence: ReminderRecurrence | null) => Promise<boolean>;
  onCreateActivityReminderRule: (
    target: ActivityReminderTarget,
    labelSnapshot: string,
    limitMinutes: number,
    message: string,
  ) => Promise<boolean>;
  onDisableActivityReminderRule: (id: number) => Promise<void>;
  onSetActivityReminderEnabled: (id: number, enabled: boolean) => Promise<void>;
  onUpdateActivityReminderLimit: (id: number, limitMinutes: number) => Promise<boolean>;
  onActivityModeActivated: (mode: ActivityReminderTarget["kind"]) => Promise<void>;
  activityReminderCandidateRevision: number;
  activityReminderCandidateLoadState: Record<ActivityReminderTarget["kind"], "idle" | "loading" | "ready" | "error">;
  onRetryActivityReminderCandidates: (mode: ActivityReminderTarget["kind"]) => void;
}

interface ActivityReminderPanelProps {
  ruleRows: ActivityReminderRuleRowViewModel[];
  appCandidates: ActivityReminderAppCandidate[];
  categoryCandidates: ActivityReminderCategoryCandidate[];
  webCandidates: ActivityReminderWebCandidate[];
  icons: Record<string, string>;
  busyAction: string | null;
  onCreateRule: ReminderToolPanelProps["onCreateActivityReminderRule"];
  onDisableRule: ReminderToolPanelProps["onDisableActivityReminderRule"];
  onSetEnabled: ReminderToolPanelProps["onSetActivityReminderEnabled"];
  onUpdateLimit: ReminderToolPanelProps["onUpdateActivityReminderLimit"];
  draft: ActivityReminderDraft;
  onDraftChange: (patch: Partial<ActivityReminderDraft>) => void;
  candidateLoadState: ReminderToolPanelProps["activityReminderCandidateLoadState"];
  onRetryCandidates: ReminderToolPanelProps["onRetryActivityReminderCandidates"];
}

interface ActivityReminderDraft {
  targetValue: string;
  durationMinutes: number;
  validationMessage: string | null;
}

const EMPTY_ACTIVITY_DRAFT: ActivityReminderDraft = {
  targetValue: "",
  durationMinutes: 30,
  validationMessage: null,
};

const ACTIVITY_TARGET_KINDS = ["app", "category", "web"] as const;

function appInitial(label: string) {
  return label.trim().slice(0, 1).toUpperCase() || "?";
}

function resolveAppIcon(icons: Record<string, string>, exeName: string | null) {
  if (!exeName) return null;
  return icons[exeName] ?? icons[exeName.toLocaleLowerCase()] ?? null;
}

function ReminderRowActions({ label, enabled, busy, onToggle, onEdit, onDelete }: {
  label: string; enabled: boolean; busy: boolean;
  onToggle: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const text = useLocaleText();
  return <div className="tools-reminder-row-actions">
    <QuietIconAction icon={enabled ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
      title={enabled ? text.tools.activityReminderDisable : text.tools.activityReminderActive}
      ariaLabel={`${text.tools.activityReminderActive}: ${label}`} pressed={enabled}
      showPressedStyle={false} busy={busy} onClick={onToggle} />
    <QuietIconAction icon={<PencilLine size={16} />} title={text.tools.activityReminderEdit}
      ariaLabel={`${text.tools.activityReminderEdit}: ${label}`} busy={busy} onClick={onEdit} />
    <QuietIconAction icon={<Trash2 size={16} />} title={text.tools.activityReminderDelete} tone="danger"
      ariaLabel={`${text.tools.activityReminderDelete}: ${label}`} busy={busy} onClick={onDelete} />
  </div>;
}

function ActivityReminderPanel({
  ruleRows,
  appCandidates,
  categoryCandidates,
  webCandidates,
  icons,
  busyAction,
  onCreateRule,
  onDisableRule,
  onSetEnabled,
  onUpdateLimit,
  draft,
  onDraftChange,
  candidateLoadState,
  onRetryCandidates,
}: ActivityReminderPanelProps) {
  const [editingRule, setEditingRule] = useState<ActivityReminderRuleRowViewModel | null>(null);
  const UI_TEXT = useLocaleText();
  const { targetValue, durationMinutes, validationMessage } = draft;
  const updateDraft = (patch: Partial<ActivityReminderDraft>) => {
    onDraftChange(patch);
  };
  const creating = busyAction === "create-activity-reminder";
  const targetOptions = useMemo(
    () => buildActivityReminderTargetOptions(appCandidates, categoryCandidates, webCandidates, icons),
    [appCandidates, categoryCandidates, icons, webCandidates],
  );
  const selectedTarget = findActivityReminderTargetOption(targetValue, targetOptions);
  const existingRule = selectedTarget
    ? findActivityReminderRuleForTarget(selectedTarget.target, ruleRows) : undefined;
  const renderRuleIcon = (row: ActivityReminderRuleRowViewModel, label = row.targetLabel) => {
    const option = findActivityReminderTargetOption(`${row.kind}:${row.targetKey}`, targetOptions);
    const icon = row.kind === "app" ? resolveAppIcon(icons, row.exeName) : option?.iconUrl;
    return <span className="data-app-option-icon" aria-hidden
      style={option?.accentColor ? { "--activity-category-color": option.accentColor } as CSSProperties : undefined}>
      {row.kind === "category" ? <span className="tools-activity-category-dot" />
        : icon ? <img src={icon} alt="" draggable={false} /> : appInitial(label)}
    </span>;
  };
  const typeLabels = {
    app: UI_TEXT.tools.reminderModeApp,
    category: UI_TEXT.tools.reminderModeCategory,
    web: UI_TEXT.tools.reminderModeWeb,
  };

  const handleCreate = async () => {
    if (!selectedTarget) {
      updateDraft({ validationMessage: UI_TEXT.tools.activityReminderTargetRequired });
      return;
    }
    updateDraft({ validationMessage: null });
    if (existingRule) {
      setEditingRule({ ...existingRule, targetLabel: selectedTarget.label });
      return;
    }
    const created = await onCreateRule(
      selectedTarget.target,
      selectedTarget.label,
      durationMinutes,
      "",
    );
    if (created) {
      updateDraft({ targetValue: "", validationMessage: null });
    }
  };

  return (
    <>
      <div className="tools-subpanel">
        <div className="tools-subpanel-header tools-reminder-subpanel-header">
          <h3>{UI_TEXT.tools.newReminder}</h3>
        </div>
        <div className="tools-reminder-form tools-software-reminder-form">
          <div className="tools-form-field">
            <span>{UI_TEXT.tools.activityReminderTargetLabel}</span>
            <ActivityReminderTargetPicker
              value={targetValue}
              appCandidates={appCandidates}
              categoryCandidates={categoryCandidates}
              webCandidates={webCandidates}
              icons={icons}
              placeholder={UI_TEXT.tools.activityReminderTargetPlaceholder}
              ariaLabel={UI_TEXT.tools.activityReminderTargetPlaceholder}
              onChange={(value) => {
                updateDraft({ targetValue: value, validationMessage: null });
              }}
            />
          </div>
          {ACTIVITY_TARGET_KINDS.filter((kind) => candidateLoadState[kind] === "error").map((kind) => (
            <div key={kind} className="tools-candidate-load-error" role="status">
              <span>{typeLabels[kind]} · {UI_TEXT.tools.activityReminderCandidatesLoadFailed}</span>
              <QuietButton size="compact" onClick={() => onRetryCandidates(kind)}>
                {UI_TEXT.common.retry}
              </QuietButton>
            </div>
          ))}
          <div className="tools-form-field">
            <span>{UI_TEXT.tools.activityReminderDurationLabel}</span>
            <ActivityReminderDurationPicker minutes={existingRule?.limitMinutes ?? durationMinutes} disabled={creating || Boolean(existingRule)}
              onChange={minutes => updateDraft({ durationMinutes: minutes, validationMessage: null })} />
          </div>
          <div className="tools-form-actions tools-software-form-actions">
            <QuietButton
              tone="primary"
              size="large"
              disabled={busyAction !== null}
              onClick={() => void handleCreate()}
              aria-label={existingRule ? `${UI_TEXT.tools.activityReminderEdit}: ${selectedTarget?.label}` : UI_TEXT.accessibility.tools.createReminder}
              busy={creating}
              className="tools-action-button"
            >
              {existingRule ? UI_TEXT.tools.activityReminderEdit : UI_TEXT.tools.createReminder}
            </QuietButton>
          </div>
          {validationMessage ? <p className="tools-validation-message">{validationMessage}</p> : null}
        </div>
      </div>

      <div className="tools-list-section tools-reminder-list-section">
        {ruleRows.length === 0 ? (
          <div className="tools-empty-state">{UI_TEXT.tools.activityReminderEmpty}</div>
        ) : (
          <div className="tools-reminder-list-frame">
            <div className="tools-reminder-list tools-software-rule-list qp-scroll-region qp-scroll-region-stable">
              {ruleRows.map((row) => {
                const busy = busyAction !== null;
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
                return (
                  <div key={row.id} className="tools-reminder-row" data-activity-rule-kind={row.kind} data-activity-rule-enabled={row.enabled}>
                    <div className="tools-reminder-row-main tools-software-rule-main">
                      {renderRuleIcon(row, currentLabel)}
                      <div className="tools-software-rule-copy">
                        <div className="tools-software-rule-heading">
                          <strong>{currentLabel}</strong>
                          <span className="tools-tabular">{row.limitLabel}</span>
                        </div>
                        {row.suspensionReason ? <span>{UI_TEXT.tools.activityReminderSuspension[row.suspensionReason]}</span>
                          : row.message ? <span>{row.message}</span> : null}
                      </div>
                    </div>
                    <ReminderRowActions label={currentLabel} enabled={row.enabled} busy={busy}
                      onToggle={() => void onSetEnabled(row.id, !row.enabled)}
                      onEdit={() => setEditingRule({ ...row, targetLabel: currentLabel })}
                      onDelete={() => void onDisableRule(row.id)} />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      {editingRule ? <ActivityReminderRuleEditor rule={editingRule}
        targetIcon={renderRuleIcon(editingRule)}
        busy={busyAction !== null} onSave={onUpdateLimit} onClose={() => setEditingRule(null)} /> : null}
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
  onUpdateReminder,
  onCreateActivityReminderRule,
  onDisableActivityReminderRule,
  onSetActivityReminderEnabled,
  onUpdateActivityReminderLimit,
  onActivityModeActivated,
  activityReminderCandidateRevision,
  activityReminderCandidateLoadState,
  onRetryActivityReminderCandidates,
}: ReminderToolPanelProps) {
  const UI_TEXT = useLocaleText();
  const [reminderMode, setReminderMode] = useState<ReminderMode>(readToolsReminderMode);
  const locale = useLocale();
  const [recurrence, setRecurrence] = useState<ReminderRecurrence | null>(null);
  const [label, setLabel] = useState("");
  const [absoluteDate, setAbsoluteDate] = useState(() => toDateInputValue(new Date(Date.now() + 15 * 60_000)));
  const [absoluteTime, setAbsoluteTime] = useState(() => toTimeInputValue(new Date(Date.now() + 15 * 60_000)));
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [activityDraft, setActivityDraft] = useState<ActivityReminderDraft>({ ...EMPTY_ACTIVITY_DRAFT });
  const [editingReminder, setEditingReminder] = useState<{ row: ReminderRowViewModel; enable: boolean } | null>(null);
  const creating = busyAction === "create-reminder";
  const reminderModes = [
    { value: "event" as const, label: UI_TEXT.tools.reminderModeEvent },
    { value: "usage" as const, label: UI_TEXT.tools.reminderModeUsage },
  ];


  useEffect(() => {
    if (reminderMode !== "event") return undefined;
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
  }, [reminderMode]);

  useEffect(() => {
    if (reminderMode !== "event") {
      for (const kind of ACTIVITY_TARGET_KINDS) void onActivityModeActivated(kind);
    }
  }, [activityReminderCandidateRevision, onActivityModeActivated, reminderMode]);

  const handleReminderModeChange = (nextMode: ReminderMode) => {
    setReminderMode(nextMode);
    rememberToolsReminderMode(nextMode);
  };
  const resolveScheduledAt = () => parseLocalDateTime(absoluteDate, absoluteTime);
  const scheduledAt = resolveScheduledAt();
  const canCreateReminder = scheduledAt !== null && scheduledAt > nowMs && validRecurrence(recurrence);
  const handleCreate = async () => {
    const nextScheduledAt = resolveScheduledAt();
    if (nextScheduledAt === null || nextScheduledAt <= Date.now() || !validRecurrence(recurrence)) return;
    const created = await onCreateReminder(
      label.trim() || UI_TEXT.tools.defaultReminderLabel,
      nextScheduledAt,
      recurrence,
    );
    if (created) setLabel("");
  };

  return (
    <section className="tools-panel qp-panel">
      <div className="tools-panel-header tools-reminder-header">
        <div className="tools-panel-title">
          <BellRing size={16} />
          <h2>{UI_TEXT.tools.remindersTitle}</h2>
        </div>
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
      <div className="tools-mode-pane" data-tools-reminder-mode={reminderMode}>
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

                </div>
                <div className="tools-reminder-form tools-event-reminder-form">
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
                  <ReminderScheduleFields date={absoluteDate} time={absoluteTime} recurrence={recurrence} disabled={creating}
                    onDateChange={setAbsoluteDate} onTimeChange={setAbsoluteTime} onRecurrenceChange={setRecurrence} />
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
                      {UI_TEXT.tools.createReminder}
                    </QuietButton>
                  </div>
                </div>
              </div>
              <div className="tools-list-section tools-reminder-list-section">
                {reminderRows.length === 0 ? (
                  <div className="tools-empty-state">{UI_TEXT.tools.reminderEmpty}</div>
                ) : (
                  <div className="tools-reminder-list-frame">
                    <div className="tools-reminder-list qp-scroll-region qp-scroll-region-stable">
                      {reminderRows.map((row) => {
                        const enabled = row.status === "scheduled" || row.status === "pending_confirmation";
                        const busy = busyAction !== null;
                        return (
                          <div key={row.id} className="tools-reminder-row" data-timed-reminder-id={row.id}>
                            <div className="tools-reminder-row-main tools-event-reminder-main">
                              <strong>{row.label}</strong>
                              <span>{row.dueLabel}</span>
                              {row.recurrence || row.status === "fired" || row.status === "pending_confirmation" ?
                                <QuietTooltip label={row.recurrence ? recurrenceLabel(row.recurrence, UI_TEXT, locale)
                                  : row.status === "fired" ? UI_TEXT.tools.reminderCompleted : UI_TEXT.tools.reminderPendingConfirmation}>
                                  <span className="tools-reminder-status-icon" tabIndex={0} role="img"
                                    aria-label={row.recurrence ? recurrenceLabel(row.recurrence, UI_TEXT, locale)
                                      : row.status === "fired" ? UI_TEXT.tools.reminderCompleted : UI_TEXT.tools.reminderPendingConfirmation}>
                                    {row.recurrence ? <Repeat size={18} aria-hidden="true" />
                                      : row.status === "fired" ? <ClipboardCheck size={18} aria-hidden="true" /> : <BellRing size={18} aria-hidden="true" />}
                                  </span>
                                </QuietTooltip> : null}
                            </div>
                            <ReminderRowActions label={row.label} enabled={enabled} busy={busy}
                              onToggle={() => {
                                if (!enabled && !row.recurrence && row.scheduledAt <= Date.now()) setEditingReminder({ row, enable: true });
                                else void onUpdateReminder(row.id, row.label, row.scheduledAt, !enabled, row.recurrence);
                              }}
                              onEdit={() => setEditingReminder({ row, enable: enabled || row.status === "fired" })}
                              onDelete={() => void onCancelReminder(row.id)} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <ActivityReminderPanel
              ruleRows={activityReminderRuleRows}
              appCandidates={activityReminderAppCandidates}
              categoryCandidates={activityReminderCategoryCandidates}
              webCandidates={activityReminderWebCandidates}
              icons={icons}
              busyAction={busyAction}
              onCreateRule={onCreateActivityReminderRule}
              onDisableRule={onDisableActivityReminderRule}
              onSetEnabled={onSetActivityReminderEnabled}
              onUpdateLimit={onUpdateActivityReminderLimit}
              draft={activityDraft}
              onDraftChange={(patch) => {
                setActivityDraft((current) => ({ ...current, ...patch }));
              }}
              candidateLoadState={activityReminderCandidateLoadState}
              onRetryCandidates={onRetryActivityReminderCandidates}
            />
          )}
        </div>
      </div>
      {editingReminder ? <TimedReminderEditor row={editingReminder.row} enabled={editingReminder.enable}
        busy={busyAction !== null} onSave={onUpdateReminder} onClose={() => setEditingReminder(null)} /> : null}
    </section>
  );
}
