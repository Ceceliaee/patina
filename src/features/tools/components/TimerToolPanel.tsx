import { Flag, Pause, Play, RotateCcw, Timer } from "lucide-react";
import { useEffect, useState } from "react";
import QuietSegmentedFilter from "../../../shared/components/QuietSegmentedFilter.tsx";
import QuietButton from "../../../shared/components/QuietButton.tsx";
import { UI_TEXT } from "../../../shared/copy/index.ts";
import type { TimerMode, ToolsRuntimeSnapshot } from "../../../shared/types/tools.ts";
import { formatHms } from "../services/toolsViewModel.ts";
import type { TimerViewModel } from "../types.ts";
import {
  formatMinuteInput,
  parseBoundedMinuteInput,
} from "../services/toolsNumberInput.ts";

interface TimerToolPanelProps {
  snapshot: ToolsRuntimeSnapshot;
  viewModel: TimerViewModel;
  mode: TimerMode;
  busyAction: string | null;
  onModeChange: (mode: TimerMode) => void;
  onStartTimer: (mode: TimerMode, durationMinutes: number, label?: string) => Promise<void>;
  onPauseTimer: () => Promise<void>;
  onResumeTimer: () => Promise<void>;
  onResetTimer: () => Promise<void>;
  onAddTimerLap: () => Promise<void>;
}

export default function TimerToolPanel({
  snapshot,
  viewModel,
  mode,
  busyAction,
  onModeChange,
  onStartTimer,
  onPauseTimer,
  onResumeTimer,
  onResetTimer,
  onAddTimerLap,
}: TimerToolPanelProps) {
  const [countdownMinutes, setCountdownMinutes] = useState(() => (
    formatMinuteInput(snapshot.settings.defaultCountdownMinutes)
  ));
  const [label, setLabel] = useState("");
  const activeTimer = snapshot.currentTimer;
  const timerLocksMode = activeTimer?.status === "running" || activeTimer?.status === "paused";
  const effectiveMode = timerLocksMode && activeTimer ? activeTimer.mode : mode;
  const hasActiveTimer = timerLocksMode;
  const starting = busyAction === "start-timer";
  const parsedCountdownMinutes = parseBoundedMinuteInput(countdownMinutes, 1, 180);
  const canStartTimer = effectiveMode !== "countdown" || parsedCountdownMinutes !== null;
  const modeOptions = [
    {
      value: "stopwatch" as const,
      label: UI_TEXT.tools.timerModeStopwatch,
      disabled: hasActiveTimer && effectiveMode !== "stopwatch",
    },
    {
      value: "countdown" as const,
      label: UI_TEXT.tools.timerModeCountdown,
      disabled: hasActiveTimer && effectiveMode !== "countdown",
    },
  ];

  useEffect(() => {
    if (!activeTimer) {
      setCountdownMinutes(formatMinuteInput(snapshot.settings.defaultCountdownMinutes));
    }
  }, [activeTimer, snapshot.settings.defaultCountdownMinutes]);

  const handleResetTimer = async () => {
    await onResetTimer();
    setLabel("");
  };

  return (
    <section className="tools-panel qp-panel">
      <div className="tools-panel-header">
        <div>
          <div className="tools-panel-title">
            <Timer size={16} />
            <h2>{UI_TEXT.tools.timerTitle}</h2>
          </div>
        </div>
      </div>

      <div className="tools-mode-pane tools-timer-mode-pane" data-tools-timer-mode={effectiveMode}>
        <div className="tools-mode-switch-row">
          <QuietSegmentedFilter
            value={effectiveMode}
            options={modeOptions}
            onChange={(nextMode) => {
              if (!hasActiveTimer) {
                onModeChange(nextMode);
              }
            }}
            className="tools-timer-kind-filter"
          />
        </div>

        <div key={effectiveMode} className="tools-mode-content-pane">
          <div className="tools-time-display">
            <span>{viewModel.helperLabel}</span>
            <strong>{viewModel.displayTime}</strong>
          </div>

          <div className="tools-timer-controls">
            <div className="tools-timer-config">
              <label className="tools-form-field">
                <span>{UI_TEXT.tools.timerLabel}</span>
                <input
                  type="text"
                  value={label}
                  disabled={hasActiveTimer}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder={UI_TEXT.tools.timerLabelPlaceholder}
                  className="qp-input"
                />
              </label>
              {effectiveMode === "countdown" ? (
                <div className="tools-form-field">
                  <span>{UI_TEXT.tools.countdownDuration}</span>
                  <input
                    id="tools-countdown-duration"
                    type="number"
                    min={1}
                    max={180}
                    value={countdownMinutes}
                    disabled={hasActiveTimer}
                    onChange={(event) => setCountdownMinutes(event.target.value)}
                    className="qp-input tools-small-number-input"
                  />
                </div>
              ) : null}
            </div>

            <div className="tools-action-row tools-timer-action-row">
              {viewModel.status === "idle" || viewModel.status === "completed" ? (
                <QuietButton
                  tone="primary"
                  size="large"
                  disabled={starting || !canStartTimer}
                  onClick={() => {
                    const durationMinutes = effectiveMode === "countdown"
                      ? parsedCountdownMinutes
                      : 1;
                    if (durationMinutes === null) return;

                    void onStartTimer(effectiveMode, durationMinutes, label.trim() || undefined);
                  }}
                  aria-label={UI_TEXT.accessibility.tools.startTimer}
                  busy={starting}
                  className="tools-action-button"
                >
                  <Play size={14} />
                  {UI_TEXT.tools.start}
                </QuietButton>
              ) : null}
              {viewModel.status === "running" ? (
                <>
                  <QuietButton
                    size="large"
                    disabled={busyAction === "pause-timer"}
                    onClick={() => void onPauseTimer()}
                    aria-label={UI_TEXT.accessibility.tools.pauseTimer}
                    busy={busyAction === "pause-timer"}
                    className="tools-action-button"
                  >
                    <Pause size={14} />
                    {UI_TEXT.tools.pause}
                  </QuietButton>
                  <QuietButton
                    size="large"
                    disabled={busyAction === "add-timer-lap"}
                    onClick={() => void onAddTimerLap()}
                    aria-label={UI_TEXT.accessibility.tools.addTimerLap}
                    busy={busyAction === "add-timer-lap"}
                    className="tools-action-button"
                  >
                    <Flag size={14} />
                    {UI_TEXT.tools.lap}
                  </QuietButton>
                </>
              ) : null}
              {viewModel.status === "paused" ? (
                <QuietButton
                  tone="primary"
                  size="large"
                  disabled={busyAction === "resume-timer"}
                  onClick={() => void onResumeTimer()}
                  aria-label={UI_TEXT.accessibility.tools.resumeTimer}
                  busy={busyAction === "resume-timer"}
                  className="tools-action-button"
                >
                  <Play size={14} />
                  {UI_TEXT.tools.resume}
                </QuietButton>
              ) : null}
              {viewModel.status !== "idle" ? (
                <QuietButton
                  size="large"
                  disabled={busyAction === "reset-timer"}
                  onClick={() => void handleResetTimer()}
                  aria-label={UI_TEXT.accessibility.tools.resetTimer}
                  busy={busyAction === "reset-timer"}
                  className="tools-action-button"
                >
                  <RotateCcw size={14} />
                  {UI_TEXT.tools.reset}
                </QuietButton>
              ) : null}
            </div>
          </div>

          <div className="tools-list-section">
            <h3>{UI_TEXT.tools.lapsTitle}</h3>
            {snapshot.timerLaps.length === 0 ? (
              <div className="tools-empty-state">{UI_TEXT.tools.lapsEmpty}</div>
            ) : (
              <div className="tools-lap-list">
                {snapshot.timerLaps.map((lap) => (
                  <div key={lap.id} className="tools-lap-row">
                    <div>
                      <strong>{UI_TEXT.tools.lapIndex(lap.lapIndex)}</strong>
                      <span>{new Date(lap.startedAt).toLocaleTimeString()} - {new Date(lap.endedAt).toLocaleTimeString()}</span>
                    </div>
                    <span className="tools-tabular">{formatHms(lap.durationMs)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
