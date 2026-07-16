import { BellRing, Plus, Search, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import QuietDatePicker from "../../../shared/components/QuietDatePicker.tsx";
import QuietButton from "../../../shared/components/QuietButton.tsx";
import QuietSegmentedFilter from "../../../shared/components/QuietSegmentedFilter.tsx";
import QuietTimePicker from "../../../shared/components/QuietTimePicker.tsx";
import { UI_TEXT } from "../../../shared/copy/index.ts";
import type { ToolSoftwareReminderAppCandidate } from "../../../shared/types/tools.ts";
import {
  readToolsReminderMode,
  readToolsReminderFormMode,
  rememberToolsReminderMode,
  rememberToolsReminderFormMode,
} from "../services/toolsLayoutPreferenceStorage.ts";
import type {
  ReminderFormMode,
  ReminderMode,
  ReminderRowViewModel,
  SoftwareReminderRuleRowViewModel,
} from "../types.ts";
import {
  formatMinuteInput,
  parseBoundedMinuteInput,
} from "../services/toolsNumberInput.ts";
import {
  filterSoftwareReminderAppCandidates,
  resolveSoftwareReminderSelectedCandidate,
  softwareReminderCandidateInputValue,
} from "../services/softwareReminderRuleForm.ts";

interface ReminderToolPanelProps {
  reminderRows: ReminderRowViewModel[];
  softwareReminderRuleRows: SoftwareReminderRuleRowViewModel[];
  softwareReminderAppCandidates: ToolSoftwareReminderAppCandidate[];
  icons: Record<string, string>;
  busyAction: string | null;
  onCreateReminder: (label: string, scheduledAt: number) => Promise<void>;
  onCancelReminder: (id: number) => Promise<void>;
  onCreateSoftwareReminderRule: (
    appName: string,
    exeName: string | null,
    limitMinutes: number,
    message: string,
  ) => Promise<void>;
  onDisableSoftwareReminderRule: (id: number) => Promise<void>;
}

interface SoftwareReminderPanelProps {
  ruleRows: SoftwareReminderRuleRowViewModel[];
  candidates: ToolSoftwareReminderAppCandidate[];
  icons: Record<string, string>;
  busyAction: string | null;
  onCreateRule: (
    appName: string,
    exeName: string | null,
    limitMinutes: number,
    message: string,
  ) => Promise<void>;
  onDisableRule: (id: number) => Promise<void>;
}

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
  if (![year, month, day, hour, minute].every(Number.isFinite)) {
    return null;
  }

  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
    || date.getHours() !== hour
    || date.getMinutes() !== minute
  ) {
    return null;
  }
  return date.getTime();
}

function reminderStatusLabel(status: ReminderRowViewModel["status"]) {
  return UI_TEXT.tools.reminderStatus[status];
}

function appInitial(appName: string) {
  return appName.trim().slice(0, 1).toUpperCase() || "?";
}

function resolveSoftwareIcon(icons: Record<string, string>, exeName: string | null) {
  if (!exeName) return null;
  return icons[exeName] ?? icons[exeName.toLocaleLowerCase()] ?? null;
}

const softwareCandidateListMaxHeight = 46 * 4 + 6 * 3 + 12;

function SoftwareReminderPanel({
  ruleRows,
  candidates,
  icons,
  busyAction,
  onCreateRule,
  onDisableRule,
}: SoftwareReminderPanelProps) {
  const searchFieldRef = useRef<HTMLDivElement | null>(null);
  const [softwareName, setSoftwareName] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("30");
  const [message, setMessage] = useState("");
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const [selectedSoftwareCandidate, setSelectedSoftwareCandidate] = useState<ToolSoftwareReminderAppCandidate | null>(null);
  const [candidateListStyle, setCandidateListStyle] = useState<CSSProperties | null>(null);
  const creating = busyAction === "create-software-reminder";
  const visibleCandidates = filterSoftwareReminderAppCandidates(softwareName, candidates);

  const updateCandidateListPosition = useCallback(() => {
    const field = searchFieldRef.current;
    if (!field) return;

    const rect = field.getBoundingClientRect();
    const viewportMargin = 12;
    const gap = 6;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(rect.width, Math.max(0, viewportWidth - viewportMargin * 2));
    const left = Math.min(
      Math.max(rect.left, viewportMargin),
      Math.max(viewportMargin, viewportWidth - viewportMargin - width),
    );
    const belowTop = rect.bottom + gap;
    const belowHeight = Math.max(0, viewportHeight - viewportMargin - belowTop);
    const aboveHeight = Math.max(0, rect.top - viewportMargin - gap);
    const openAbove = belowHeight < 180 && aboveHeight > belowHeight;
    const viewportListHeight = Math.max(80, viewportHeight - viewportMargin * 2);
    const availableHeight = openAbove ? aboveHeight : belowHeight;
    const maxHeight = Math.min(
      viewportListHeight,
      softwareCandidateListMaxHeight,
      Math.max(120, availableHeight),
    );
    const top = openAbove
      ? Math.max(viewportMargin, rect.top - gap - maxHeight)
      : Math.min(belowTop, viewportHeight - viewportMargin - maxHeight);

    setCandidateListStyle({ left, top, width, maxHeight });
  }, []);

  useLayoutEffect(() => {
    if (!searchFocused || visibleCandidates.length === 0) {
      setCandidateListStyle(null);
      return undefined;
    }

    updateCandidateListPosition();
    window.addEventListener("resize", updateCandidateListPosition);
    window.addEventListener("scroll", updateCandidateListPosition, true);
    return () => {
      window.removeEventListener("resize", updateCandidateListPosition);
      window.removeEventListener("scroll", updateCandidateListPosition, true);
    };
  }, [searchFocused, updateCandidateListPosition, visibleCandidates.length]);

  const handleSoftwareNameChange = (value: string) => {
    setSoftwareName(value);
    setValidationMessage(null);
    setSelectedSoftwareCandidate((current) => (
      current && value.trim() === softwareReminderCandidateInputValue(current).trim()
        ? current
        : null
    ));
  };

  const handleCreateRule = async () => {
    const selectedCandidate = resolveSoftwareReminderSelectedCandidate(
      softwareName,
      candidates,
      selectedSoftwareCandidate,
    );
    const limitMinutes = Number(durationMinutes);
    if (!selectedCandidate) {
      setValidationMessage(UI_TEXT.tools.softwareReminderAppRequired);
      return;
    }
    if (!Number.isFinite(limitMinutes) || limitMinutes < 1) {
      setValidationMessage(UI_TEXT.tools.softwareReminderDurationInvalid);
      return;
    }

    setValidationMessage(null);
    await onCreateRule(
      selectedCandidate.appName,
      selectedCandidate.exeName,
      Math.min(1440, Math.max(1, Math.round(limitMinutes))),
      message.trim(),
    );
    setSoftwareName("");
    setSelectedSoftwareCandidate(null);
    setMessage("");
  };

  return (
    <>
      <div className="tools-subpanel">
        <div className="tools-subpanel-header tools-reminder-subpanel-header">
          <h3>{UI_TEXT.tools.newReminder}</h3>
        </div>

        <div className="tools-reminder-form tools-software-reminder-form">
          <div ref={searchFieldRef} className="tools-form-field tools-software-search-field">
            <span>{UI_TEXT.tools.softwareReminderAppLabel}</span>
            <label className="data-app-search tools-software-app-search">
              <Search size={14} aria-hidden />
              <input
                type="text"
                value={softwareName}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                onChange={(event) => handleSoftwareNameChange(event.target.value)}
                placeholder={UI_TEXT.tools.softwareReminderAppPlaceholder}
                aria-label={UI_TEXT.tools.softwareReminderAppPlaceholder}
              />
            </label>
            {searchFocused && visibleCandidates.length > 0 && candidateListStyle ? (
              <div
                className="tools-software-candidate-list data-app-list"
                style={candidateListStyle}
              >
                {visibleCandidates.map((candidate) => (
                  <button
                    key={`${candidate.exeName}:${candidate.appName}`}
                    type="button"
                    className="data-app-option"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setSoftwareName(softwareReminderCandidateInputValue(candidate));
                      setSelectedSoftwareCandidate(candidate);
                      setValidationMessage(null);
                      setSearchFocused(false);
                    }}
                  >
                    <span className="data-app-option-icon" aria-hidden>
                      {resolveSoftwareIcon(icons, candidate.exeName) ? (
                        <img
                          src={resolveSoftwareIcon(icons, candidate.exeName) ?? undefined}
                          alt=""
                          draggable={false}
                        />
                      ) : (
                        appInitial(candidate.appName)
                      )}
                    </span>
                    <span className="data-app-option-main">
                      <span className="data-app-option-name">{candidate.appName}</span>
                      <span className="data-app-option-meta">{candidate.exeName}</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <label className="tools-form-field">
            <span>{UI_TEXT.tools.softwareReminderDurationLabel}</span>
            <input
              type="number"
              min={1}
              max={1440}
              value={durationMinutes}
              onChange={(event) => setDurationMinutes(event.target.value)}
              className="qp-input tools-small-number-input"
            />
          </label>

          <label className="tools-form-field">
            <span>{UI_TEXT.tools.softwareReminderMessageLabel}</span>
            <input
              type="text"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder={UI_TEXT.tools.softwareReminderMessagePlaceholder}
              className="qp-input"
            />
          </label>

          <div className="tools-form-actions tools-software-form-actions">
            <QuietButton
              tone="primary"
              disabled={creating}
              onClick={() => void handleCreateRule()}
              aria-label={UI_TEXT.accessibility.tools.createReminder}
              busy={creating}
              className="tools-action-button"
            >
              <Plus size={14} />
              {UI_TEXT.tools.createReminder}
            </QuietButton>
          </div>

          {validationMessage ? (
            <p className="tools-validation-message">{validationMessage}</p>
          ) : null}
        </div>
      </div>

      <div className="tools-list-section tools-reminder-list-section">
        <h3>{UI_TEXT.tools.softwareReminderRulesTitle}</h3>
        {ruleRows.length === 0 ? (
          <div className="tools-empty-state">{UI_TEXT.tools.softwareReminderEmpty}</div>
        ) : (
          <div className="tools-reminder-list tools-software-rule-list">
            {ruleRows.map((row) => {
              const disabling = busyAction === `disable-software-reminder:${row.id}`;
              return (
                <div key={row.id} className="tools-reminder-row">
                  <div className="tools-reminder-row-main tools-software-rule-main">
                    <span className="data-app-option-icon" aria-hidden>
                      {resolveSoftwareIcon(icons, row.exeName) ? (
                        <img
                          src={resolveSoftwareIcon(icons, row.exeName) ?? undefined}
                          alt=""
                          draggable={false}
                        />
                      ) : (
                        appInitial(row.appLabel)
                      )}
                    </span>
                    <div className="tools-software-rule-copy">
                      <strong>{row.appLabel}</strong>
                      <span>{row.message}</span>
                    </div>
                  </div>
                  <div className="tools-reminder-row-meta">
                    <span className="tools-status-pill tools-status-scheduled">
                      {row.statusLabel}
                    </span>
                    <span className="tools-tabular">{row.limitLabel}</span>
                    <button
                      type="button"
                      disabled={disabling}
                      aria-label={`${UI_TEXT.tools.softwareReminderDisable}: ${row.appLabel}`}
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
  softwareReminderRuleRows,
  softwareReminderAppCandidates,
  icons,
  busyAction,
  onCreateReminder,
  onCancelReminder,
  onCreateSoftwareReminderRule,
  onDisableSoftwareReminderRule,
}: ReminderToolPanelProps) {
  const [reminderMode, setReminderMode] = useState<ReminderMode>(readToolsReminderMode);
  const [mode, setMode] = useState<ReminderFormMode>(readToolsReminderFormMode);
  const [label, setLabel] = useState("");
  const [relativeMinutes, setRelativeMinutes] = useState(() => formatMinuteInput(15));
  const [absoluteDate, setAbsoluteDate] = useState(() => toDateInputValue(new Date()));
  const [absoluteTime, setAbsoluteTime] = useState(() => toTimeInputValue(new Date()));
  const [nowMs, setNowMs] = useState(() => Date.now());
  const scheduledRows = reminderRows.filter((row) => row.status === "scheduled");
  const creating = busyAction === "create-reminder";
  const reminderModes = [
    { value: "event" as const, label: UI_TEXT.tools.reminderModeEvent },
    { value: "software" as const, label: UI_TEXT.tools.reminderModeSoftware },
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
      if (refreshTimeout !== null) {
        window.clearTimeout(refreshTimeout);
      }
    };
  }, [mode, reminderMode]);

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
    if (nextScheduledAt === null || nextScheduledAt <= Date.now()) {
      return;
    }

    await onCreateReminder(label.trim() || UI_TEXT.tools.defaultReminderLabel, nextScheduledAt);
    setLabel("");
  };

  return (
    <section className="tools-panel qp-panel">
      <div className="tools-panel-header">
        <div>
          <div className="tools-panel-title">
            <BellRing size={16} />
            <h2>{UI_TEXT.tools.remindersTitle}</h2>
          </div>
        </div>
      </div>

      <div className="tools-mode-pane" data-tools-reminder-mode={reminderMode}>
        <div className="tools-mode-switch-row">
          <QuietSegmentedFilter
            value={reminderMode}
            options={reminderModes}
            onChange={handleReminderModeChange}
            className="tools-reminder-kind-filter"
          />
        </div>

        <div key={reminderMode} className="tools-mode-content-pane">
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
                      <QuietDatePicker
                        value={absoluteDate}
                        onChange={setAbsoluteDate}
                        ariaLabel={UI_TEXT.date.pickDate}
                      />
                    </div>
                    <div className="tools-form-field">
                      <span>{UI_TEXT.tools.absoluteTimeLabel}</span>
                      <QuietTimePicker
                        value={absoluteTime}
                        onChange={setAbsoluteTime}
                        ariaLabel={UI_TEXT.time.pickTime}
                      />
                    </div>
                  </div>
                )}

                <div className="tools-form-actions">
                  <QuietButton
                    tone="primary"
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
                <div className="tools-reminder-list">
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
                            {reminderStatusLabel(row.status)}
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
            <SoftwareReminderPanel
              ruleRows={softwareReminderRuleRows}
              candidates={softwareReminderAppCandidates}
              icons={icons}
              busyAction={busyAction}
              onCreateRule={onCreateSoftwareReminderRule}
              onDisableRule={onDisableSoftwareReminderRule}
            />
          )}
        </div>
      </div>
    </section>
  );
}
