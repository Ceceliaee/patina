import { AlarmClock, FastForward, Pause, Play, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import QuietButton from "../../../shared/components/QuietButton.tsx";
import { UI_TEXT } from "../../../shared/copy/index.ts";
import type { StartPomodoroInput, ToolsRuntimeSnapshot } from "../../../shared/types/tools.ts";
import type { PomodoroViewModel } from "../types.ts";
import ToolDurationInput from "./ToolDurationInput.tsx";
import {
  formatMinuteInput,
  parseBoundedMinuteInput,
} from "../services/toolsNumberInput.ts";

interface PomodoroToolPanelProps {
  snapshot: ToolsRuntimeSnapshot;
  viewModel: PomodoroViewModel;
  busyAction: string | null;
  onStartPomodoro: (input?: Partial<StartPomodoroInput>) => Promise<void>;
  onPausePomodoro: () => Promise<void>;
  onResumePomodoro: () => Promise<void>;
  onSkipPomodoroPhase: () => Promise<void>;
  onResetPomodoro: () => Promise<void>;
}

export default function PomodoroToolPanel({
  snapshot,
  viewModel,
  busyAction,
  onStartPomodoro,
  onPausePomodoro,
  onResumePomodoro,
  onSkipPomodoroPhase,
  onResetPomodoro,
}: PomodoroToolPanelProps) {
  const [focusMinutes, setFocusMinutes] = useState(() => formatMinuteInput(snapshot.settings.pomodoroFocusMinutes));
  const [shortBreakMinutes, setShortBreakMinutes] = useState(() => formatMinuteInput(snapshot.settings.pomodoroShortBreakMinutes));
  const [longBreakMinutes, setLongBreakMinutes] = useState(() => formatMinuteInput(snapshot.settings.pomodoroLongBreakMinutes));
  const [longBreakEvery, setLongBreakEvery] = useState(() => formatMinuteInput(snapshot.settings.pomodoroLongBreakEvery));
  const restoreDefaultDurations = useCallback(() => {
    setFocusMinutes(formatMinuteInput(snapshot.settings.pomodoroFocusMinutes));
    setShortBreakMinutes(formatMinuteInput(snapshot.settings.pomodoroShortBreakMinutes));
    setLongBreakMinutes(formatMinuteInput(snapshot.settings.pomodoroLongBreakMinutes));
    setLongBreakEvery(formatMinuteInput(snapshot.settings.pomodoroLongBreakEvery));
  }, [
    snapshot.settings.pomodoroFocusMinutes,
    snapshot.settings.pomodoroLongBreakEvery,
    snapshot.settings.pomodoroLongBreakMinutes,
    snapshot.settings.pomodoroShortBreakMinutes,
  ]);
  const run = snapshot.currentPomodoro;
  const status = run?.status ?? "idle";
  const isRunning = status === "running";
  const isPaused = status === "paused";
  const hasStarted = Boolean(run) && status !== "idle";
  const controlsDisabled = busyAction !== null;
  const parsedFocusMinutes = parseBoundedMinuteInput(focusMinutes, 1, 180);
  const parsedShortBreakMinutes = parseBoundedMinuteInput(shortBreakMinutes, 1, 60);
  const parsedLongBreakMinutes = parseBoundedMinuteInput(longBreakMinutes, 1, 120);
  const parsedLongBreakEvery = parseBoundedMinuteInput(longBreakEvery, 2, 12);
  const cycleTotal = Math.max(1, Math.min(
    12,
    run?.longBreakEvery ?? parsedLongBreakEvery ?? snapshot.settings.pomodoroLongBreakEvery,
  ));
  const cycleIndex = Math.max(1, Math.min(cycleTotal, run?.cycleIndex ?? 1));
  const cycleMarkers = Array.from({ length: cycleTotal }, (_, index) => index + 1);

  useEffect(() => {
    if (!run || run.status === "idle") {
      restoreDefaultDurations();
    }
  }, [
    run,
    run?.id,
    run?.status,
    restoreDefaultDurations,
  ]);

  const startInput: StartPomodoroInput | null = (
    parsedFocusMinutes === null
    || parsedShortBreakMinutes === null
    || parsedLongBreakMinutes === null
    || parsedLongBreakEvery === null
  )
    ? null
    : {
        focusMs: parsedFocusMinutes * 60_000,
        shortBreakMs: parsedShortBreakMinutes * 60_000,
        longBreakMs: parsedLongBreakMinutes * 60_000,
        longBreakEvery: parsedLongBreakEvery,
      };

  return (
    <section className="tools-panel qp-panel">
      <div className="tools-panel-header">
        <div>
          <div className="tools-panel-title">
            <AlarmClock size={16} />
            <h2>{UI_TEXT.tools.pomodoroTitle}</h2>
          </div>
        </div>
      </div>

      <div className="tools-pomodoro-workbench">
        <div className="tools-pomodoro-display">
          <div className="tools-pomodoro-primary">
            <span className="tools-pomodoro-phase">{viewModel.phaseLabel}</span>
            <strong>{viewModel.remainingLabel}</strong>
          </div>
          <div className="tools-pomodoro-cycle-track" aria-hidden="true">
            {cycleMarkers.map((marker) => (
              <span
                key={marker}
                className={[
                  "tools-pomodoro-cycle-dot",
                  marker === cycleIndex ? "tools-pomodoro-cycle-dot-active" : "",
                  marker < cycleIndex ? "tools-pomodoro-cycle-dot-complete" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              />
            ))}
          </div>
          <div className="tools-pomodoro-metrics">
            <span>{viewModel.cycleLabel}</span>
            <span>{viewModel.todayCompletedLabel}</span>
          </div>
        </div>

        <div className="tools-action-row tools-pomodoro-actions">
          {!hasStarted || run?.status === "idle" || run?.status === "completed" ? (
            <QuietButton
              tone="primary"
              disabled={controlsDisabled || !startInput}
              onClick={() => {
                if (!startInput) return;
                void onStartPomodoro(startInput);
              }}
              aria-label={UI_TEXT.accessibility.tools.startPomodoro}
              busy={busyAction === "start-pomodoro"}
              className="tools-action-button"
            >
              <Play size={14} />
              {UI_TEXT.tools.start}
            </QuietButton>
          ) : null}
          {isRunning ? (
            <QuietButton
              disabled={controlsDisabled}
              onClick={() => void onPausePomodoro()}
              aria-label={UI_TEXT.accessibility.tools.pausePomodoro}
              busy={busyAction === "pause-pomodoro"}
              className="tools-action-button"
            >
              <Pause size={14} />
              {UI_TEXT.tools.pause}
            </QuietButton>
          ) : null}
          {isPaused ? (
            <QuietButton
              tone="primary"
              disabled={controlsDisabled}
              onClick={() => void onResumePomodoro()}
              aria-label={UI_TEXT.accessibility.tools.resumePomodoro}
              busy={busyAction === "resume-pomodoro"}
              className="tools-action-button"
            >
              <Play size={14} />
              {UI_TEXT.tools.resume}
            </QuietButton>
          ) : null}
          {hasStarted ? (
            <>
              <QuietButton
                disabled={controlsDisabled}
                onClick={() => void onSkipPomodoroPhase()}
                aria-label={UI_TEXT.accessibility.tools.skipPomodoroPhase}
                busy={busyAction === "skip-pomodoro-phase"}
                className="tools-action-button"
              >
                <FastForward size={14} />
                {UI_TEXT.tools.skipPhase}
              </QuietButton>
              <QuietButton
                disabled={controlsDisabled}
                onClick={() => void onResetPomodoro()}
                aria-label={UI_TEXT.accessibility.tools.resetPomodoro}
                busy={busyAction === "reset-pomodoro"}
                className="tools-action-button"
              >
                <RotateCcw size={14} />
                {UI_TEXT.tools.reset}
              </QuietButton>
            </>
          ) : null}
        </div>
      </div>

      <div className="tools-subpanel tools-pomodoro-rules">
        <div className="tools-subpanel-header">
          <div className="tools-subpanel-title-action">
            <h3>{UI_TEXT.tools.pomodoroSettings}</h3>
            <button
              type="button"
              disabled={hasStarted}
              onClick={restoreDefaultDurations}
              aria-label={UI_TEXT.accessibility.tools.restorePomodoroDefaults}
              className="tools-ghost-icon-button"
            >
              <RotateCcw size={14} />
            </button>
          </div>
        </div>
        <div className="tools-pomodoro-settings-grid">
          <ToolDurationInput
            id="tools-pomodoro-focus"
            label={UI_TEXT.tools.focusDuration}
            minutes={focusMinutes}
            minMinutes={1}
            maxMinutes={180}
            disabled={hasStarted}
            onMinutesChange={setFocusMinutes}
          />
          <ToolDurationInput
            id="tools-pomodoro-short-break"
            label={UI_TEXT.tools.shortBreakDuration}
            minutes={shortBreakMinutes}
            minMinutes={1}
            maxMinutes={60}
            disabled={hasStarted}
            onMinutesChange={setShortBreakMinutes}
          />
          <ToolDurationInput
            id="tools-pomodoro-long-break"
            label={UI_TEXT.tools.longBreakDuration}
            minutes={longBreakMinutes}
            minMinutes={1}
            maxMinutes={120}
            disabled={hasStarted}
            onMinutesChange={setLongBreakMinutes}
          />
          <ToolDurationInput
            id="tools-pomodoro-long-break-every"
            label={UI_TEXT.tools.longBreakEvery}
            minutes={longBreakEvery}
            minMinutes={2}
            maxMinutes={12}
            disabled={hasStarted}
            onMinutesChange={setLongBreakEvery}
          />
        </div>
      </div>
    </section>
  );
}
