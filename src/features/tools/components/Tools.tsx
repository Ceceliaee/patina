import { AlarmClock, BellRing, RefreshCw, Timer, ToolCase } from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import QuietPageHeader from "../../../shared/components/QuietPageHeader.tsx";
import type { QuietToastTone } from "../../../shared/components/QuietToast.tsx";
import { UI_TEXT, type UiText } from "../../../shared/copy/index.ts";
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

interface ToolsProps {
  initialTarget?: ToolsOpenTarget | null;
  icons: Record<string, string>;
  onInitialTargetConsumed?: () => void;
  onToast?: (message: string, tone?: QuietToastTone) => void;
  uiText?: UiText;
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
  onInitialTargetConsumed,
  onToast,
  uiText = UI_TEXT,
}: ToolsProps) {
  const [activeSection, setActiveSection] = useState<ToolsSection>(() => (
    initialTarget ? normalizeToolsSection(initialTarget) : readToolsSection()
  ));
  const [visitedSections, setVisitedSections] = useState<ReadonlySet<ToolsSection>>(
    () => new Set([initialTarget ? normalizeToolsSection(initialTarget) : readToolsSection()]),
  );
  const [selectedTimerMode, setSelectedTimerMode] = useState<TimerMode>(readToolsTimerMode);
  const handleError = useCallback((message: string) => {
    onToast?.(message, "warning");
  }, [onToast]);
  const state = useToolsPageState({
    activeSection,
    onError: handleError,
    uiText,
  });
  const toolsIconExeNames = useMemo(() => [
    ...state.softwareReminderAppCandidates.map((candidate) => candidate.exeName),
    ...state.softwareReminderRuleRows.map((row) => row.exeName),
  ], [state.softwareReminderAppCandidates, state.softwareReminderRuleRows]);
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
        titleSuffix={<span className="qp-page-header-beta">{UI_TEXT.tools.beta}</span>}
        subtitle={UI_TEXT.tools.subtitle}
      />

      {state.loading ? (
        <div className="tools-loading qp-panel">
          <RefreshCw size={18} className="animate-spin" />
          <span>{UI_TEXT.common.loading}</span>
        </div>
      ) : null}

      <div className={state.loading ? "tools-page-body tools-page-body-hidden" : "tools-page-body"}>
        <div className="tools-workspace">
          <aside
            className="tools-section-rail tools-section-rail-shell"
            aria-label={UI_TEXT.tools.title}
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
                  className={selected ? "tools-section-tab tools-section-tab-active" : "tools-section-tab"}
                >
                  <span className="tools-section-tab-icon">
                    <Icon size={17} />
                  </span>
                </button>
              );
            })}
          </aside>

          <div className="tools-active-panel">
            {visitedSections.has("reminders") ? (
              <div className={activeSection === "reminders" ? "tools-section-pane" : "tools-section-pane tools-section-pane-hidden"} data-tools-section="reminders">
                <ReminderToolPanel
                  reminderRows={state.reminderRows}
                  softwareReminderRuleRows={state.softwareReminderRuleRows}
                  softwareReminderAppCandidates={state.softwareReminderAppCandidates}
                  icons={toolsIcons}
                  busyAction={state.busyAction}
                  onCreateReminder={state.createReminder}
                  onCancelReminder={state.cancelReminder}
                  onCreateSoftwareReminderRule={state.createSoftwareReminderRule}
                  onDisableSoftwareReminderRule={state.disableSoftwareReminderRule}
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
      </div>
    </div>
  );
}
