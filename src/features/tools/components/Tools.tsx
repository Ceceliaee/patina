import { useLocaleText } from "../../../shared/i18n/index.ts";
import { AlarmClock, BellRing, Settings, Timer, ToolCase } from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import QuietBadge from "../../../shared/components/QuietBadge.tsx";
import QuietButton from "../../../shared/components/QuietButton.tsx";
import QuietPageHeader from "../../../shared/components/QuietPageHeader.tsx";
import type { QuietToastTone } from "../../../shared/types/toast.ts";
import { useRequestedAppIcons } from "../../../shared/hooks/useRequestedAppIcons.ts";
import type { TimerMode } from "../../../shared/types/tools.ts";
import { useToolsPageState } from "../hooks/useToolsPageState.ts";
import {
  readToolsSection,
  readToolsTimerMode,
  rememberToolsSection,
  rememberToolsTimerMode,
} from "../services/toolsLayoutPreferenceStorage.ts";
import { loadToolsIconsForExecutables } from "../services/toolsIconService.ts";
import type { ToolsOpenTarget, ToolsSection } from "../types.ts";
import PomodoroToolPanel from "./PomodoroToolPanel.tsx";
import ReminderToolPanel from "./ReminderToolPanel.tsx";
import TimerToolPanel from "./TimerToolPanel.tsx";
import ToolsSettingsDialog from "./ToolsSettingsDialog.tsx";

interface ToolsProps {
  initialTarget?: ToolsOpenTarget | null;
  icons: Record<string, string>;
  showNavigationLabels?: boolean;
  onInitialTargetConsumed?: () => void;
  onToast?: (message: string, tone?: QuietToastTone) => void;
}

type ToolsSectionRailStyle = CSSProperties & { "--tools-active-section-index"?: number };

function normalizeToolsSection(target: ToolsOpenTarget): ToolsSection {
  if (target.section === "timing") {
    return target.timingMode === "timer" || isTimerMode(target.timingMode) ? "timer" : "reminders";
  }
  return target.section;
}

function isTimerMode(mode: ToolsOpenTarget["timingMode"]): mode is TimerMode {
  return mode === "stopwatch" || mode === "countdown";
}

function addVisitedSection(current: ReadonlySet<ToolsSection>, section: ToolsSection): ReadonlySet<ToolsSection> {
  if (current.has(section)) {
    return current;
  }

  const next = new Set(current);
  next.add(section);
  return next;
}

export default function Tools({
  initialTarget = null,
  icons,
  showNavigationLabels = false,
  onInitialTargetConsumed,
  onToast,
}: ToolsProps) {
  const UI_TEXT = useLocaleText();
  const [activeSection, setActiveSection] = useState<ToolsSection>(() => (
    initialTarget ? normalizeToolsSection(initialTarget) : readToolsSection()
  ));
  const [visitedSections, setVisitedSections] = useState<ReadonlySet<ToolsSection>>(
    () => new Set([initialTarget ? normalizeToolsSection(initialTarget) : readToolsSection()]),
  );
  const [selectedTimerMode, setSelectedTimerMode] = useState<TimerMode>(readToolsTimerMode);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const handleError = useCallback((message: string) => {
    onToast?.(message, "error");
  }, [onToast]);
  const state = useToolsPageState({
    activeSection,
    onError: handleError,
    uiText: UI_TEXT,
  });
  const toolsIconExeNames = useMemo(() => [
    ...state.activityReminderAppCandidates.map((candidate) => candidate.exeName),
    ...state.activityReminderRuleRows.map((row) => row.exeName),
  ], [state.activityReminderAppCandidates, state.activityReminderRuleRows]);
  const toolsIcons = useRequestedAppIcons({
    baseIcons: icons,
    exeNames: toolsIconExeNames,
    loadIcons: loadToolsIconsForExecutables,
    enabled: visitedSections.has("reminders"),
    onError: (error) => {
      console.warn("Failed to refresh tools app icons:", error);
    },
  });

  const resolveTimerMode = useCallback((target: ToolsOpenTarget): TimerMode | null => {
    if (target.timerMode) {
      return target.timerMode;
    }
    if (isTimerMode(target.timingMode)) {
      return target.timingMode;
    }
    return null;
  }, []);

  useEffect(() => {
    if (!initialTarget) return;

    const nextSection = normalizeToolsSection(initialTarget);
    setActiveSection(nextSection);
    setVisitedSections((current) => addVisitedSection(current, nextSection));
    rememberToolsSection(nextSection);
    if (nextSection === "timer") {
      const nextTimerMode = resolveTimerMode(initialTarget);
      if (nextTimerMode) {
        setSelectedTimerMode(nextTimerMode);
        rememberToolsTimerMode(nextTimerMode);
      }
    }
    onInitialTargetConsumed?.();
  }, [initialTarget, onInitialTargetConsumed, resolveTimerMode]);

  const handleTimerModeChange = useCallback((mode: TimerMode) => {
    setSelectedTimerMode(mode);
    rememberToolsTimerMode(mode);
  }, []);

  const handleSectionChange = useCallback((section: ToolsSection) => {
    setActiveSection(section);
    setVisitedSections((current) => addVisitedSection(current, section));
    rememberToolsSection(section);
  }, []);

  const sections = [
    {
      id: "reminders" as const,
      icon: BellRing,
      title: UI_TEXT.tools.remindersTitle,
    },
    {
      id: "timer" as const,
      icon: Timer,
      title: UI_TEXT.tools.timerTitle,
    },
    {
      id: "pomodoro" as const,
      icon: AlarmClock,
      title: UI_TEXT.tools.pomodoroTitle,
    },
  ];
  const activeSectionIndex = sections.findIndex((section) => section.id === activeSection);
  const sectionRailStyle: ToolsSectionRailStyle = {
    "--tools-active-section-index": Math.max(0, activeSectionIndex),
  };

  return (
    <div className="tools-page">
      <QuietPageHeader
        icon={<ToolCase size={18} />}
        title={UI_TEXT.tools.title}
        titleSuffix={<QuietBadge variant="beta">{UI_TEXT.tools.beta}</QuietBadge>}
        subtitle={UI_TEXT.tools.subtitle}
      />

      {!state.hasSnapshot ? (
        <div className="tools-loading qp-panel">
          <span>{state.loadError ? UI_TEXT.tools.loadFailed : UI_TEXT.common.loading}</span>
          {state.loadError ? (
            <QuietButton size="regular" onClick={() => { void state.retryLoad(); }}>
              {UI_TEXT.tools.retry}
            </QuietButton>
          ) : null}
        </div>
      ) : null}

      {state.hasSnapshot ? <div className="tools-page-body qp-scroll-region">
        <div className="tools-workspace">
          <aside
            className="tools-section-rail tools-section-rail-shell"
            aria-label={UI_TEXT.tools.title}
            data-tools-navigation-mode={showNavigationLabels ? "labeled" : "icons"}
            style={sectionRailStyle}
          >
            {activeSectionIndex >= 0 ? (
              <span className="tools-section-active-bg" aria-hidden="true" />
            ) : null}
            {sections.map((section) => {
              const Icon = section.icon;
              const selected = activeSection === section.id;

              return (
                <button
                  key={section.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => handleSectionChange(section.id)}
                  aria-label={section.title}
                  className={[
                    "tools-section-tab",
                    selected ? "tools-section-tab-active" : "",
                    showNavigationLabels ? "tools-section-tab-labeled" : "",
                  ].filter(Boolean).join(" ")}
                >
                  <span className="tools-section-tab-icon">
                    <Icon size={showNavigationLabels ? 15 : 17} />
                  </span>
                  {showNavigationLabels ? (
                    <span
                      className="tools-section-tab-copy"
                      data-tools-section-label=""
                      aria-hidden="true"
                    >
                      {section.title}
                    </span>
                  ) : null}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label={UI_TEXT.tools.settingsTitle}
              className="tools-section-tab tools-section-settings-tab"
            >
              <span className="tools-section-tab-icon">
                <Settings size={17} />
              </span>
            </button>
          </aside>

          <div className="tools-active-panel">
            {visitedSections.has("reminders") ? (
              <div className={activeSection === "reminders" ? "tools-section-pane" : "tools-section-pane tools-section-pane-hidden"} data-tools-section="reminders">
                <ReminderToolPanel
                  reminderRows={state.reminderRows}
                  activityReminderRuleRows={state.activityReminderRuleRows}
                  activityReminderAppCandidates={state.activityReminderAppCandidates}
                  activityReminderCategoryCandidates={state.activityReminderCategoryCandidates}
                  activityReminderWebCandidates={state.activityReminderWebCandidates}
                  icons={toolsIcons}
                  busyAction={state.busyAction}
                  onCreateReminder={state.createReminder}
                  onCancelReminder={state.cancelReminder}
                  onCreateActivityReminderRule={state.createActivityReminderRule}
                  onDisableActivityReminderRule={state.disableActivityReminderRule}
                  onActivityModeActivated={state.activateActivityReminderMode}
                  activityReminderCandidateRevision={state.activityReminderCandidateRevision}
                  activityReminderCandidateLoadState={state.activityReminderCandidateLoadState}
                  onRetryActivityReminderCandidates={state.retryActivityReminderCandidates}
                />
              </div>
            ) : null}
            {visitedSections.has("timer") ? (
              <div className={activeSection === "timer" ? "tools-section-pane" : "tools-section-pane tools-section-pane-hidden"} data-tools-section="timer">
                <TimerToolPanel
                  snapshot={state.snapshot}
                  viewModel={state.timerViewModel}
                  mode={selectedTimerMode}
                  busyAction={state.busyAction}
                  onModeChange={handleTimerModeChange}
                  onStartTimer={state.startTimer}
                  onPauseTimer={state.pauseTimer}
                  onResumeTimer={state.resumeTimer}
                  onResetTimer={state.resetTimer}
                  onAddTimerLap={state.addTimerLap}
                />
              </div>
            ) : null}
            {visitedSections.has("pomodoro") ? (
              <div className={activeSection === "pomodoro" ? "tools-section-pane" : "tools-section-pane tools-section-pane-hidden"} data-tools-section="pomodoro">
                <PomodoroToolPanel
                  snapshot={state.snapshot}
                  viewModel={state.pomodoroViewModel}
                  busyAction={state.busyAction}
                  onStartPomodoro={state.startPomodoro}
                  onPausePomodoro={state.pausePomodoro}
                  onResumePomodoro={state.resumePomodoro}
                  onSkipPomodoroPhase={state.skipPomodoroPhase}
                  onResetPomodoro={state.resetPomodoro}
                />
              </div>
            ) : null}
          </div>
        </div>
      </div> : null}
      <ToolsSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
