import { AlarmClock } from "lucide-react";
import { useState } from "react";
import { useLocaleText } from "../../../shared/i18n/index.ts";
import QuietButton from "../../../shared/components/QuietButton.tsx";
import QuietSegmentedFilter from "../../../shared/components/QuietSegmentedFilter.tsx";
import type { FreeFocusAction, PomodoroTaskAction, ToolPomodoroTask, ToolsRuntimeSnapshot } from "../../../shared/types/tools.ts";
import FreeFocusContent from "./FreeFocusContent.tsx";
import { formatMinuteInput, parseBoundedMinuteInput } from "../services/toolsNumberInput.ts";
import PomodoroSettingsPicker, { POMODORO_DURATION_BOUNDS } from "./PomodoroSettingsPicker.tsx";
import PomodoroTaskRow from "./PomodoroTaskRow.tsx";
import PomodoroTaskEditor from "./PomodoroTaskEditor.tsx";

interface PomodoroToolPanelProps {
  snapshot: ToolsRuntimeSnapshot;
  nowMs: number;
  busyAction: string | null;
  onAction: (action: PomodoroTaskAction) => Promise<boolean>;
  onFreeFocus: (action: FreeFocusAction) => Promise<boolean>;
}

export default function PomodoroToolPanel({ snapshot, nowMs, busyAction, onAction, onFreeFocus }: PomodoroToolPanelProps) {
  const UI_TEXT = useLocaleText();
  const defaults = () => [snapshot.settings.pomodoroFocusMinutes, snapshot.settings.pomodoroShortBreakMinutes,
    snapshot.settings.pomodoroLongBreakMinutes, snapshot.settings.pomodoroLongBreakEvery].map(formatMinuteInput);
  const [values, setValues] = useState(defaults);
  const [label, setLabel] = useState("");
  const [mode, setMode] = useState<"pomodoro" | "free">(() => snapshot.freeFocusTasks.some(t => t.status === "running") ? "free" : "pomodoro");
  const [editingTask, setEditingTask] = useState<ToolPomodoroTask | null>(null);
  const disabled = busyAction !== null;
  const bounds = POMODORO_DURATION_BOUNDS;
  const parsed = values.map((value, index) => parseBoundedMinuteInput(value, bounds[index][0], bounds[index][1]));

  return <section className="tools-panel tools-pomodoro-task-panel qp-panel">
    <div className="tools-panel-header tools-focus-header">
      <div className="tools-panel-title"><AlarmClock size={16} /><h2>{UI_TEXT.tools.pomodoroTitle}</h2></div>
      <QuietSegmentedFilter value={mode} options={[
        { value: "pomodoro", label: UI_TEXT.tools.focusModePomodoro },
        { value: "free", label: UI_TEXT.tools.focusModeFree },
      ]} onChange={value => setMode(value === "free" ? "free" : "pomodoro")} ariaLabel={UI_TEXT.tools.pomodoroTitle} />
    </div>
    {mode === "free" ? <FreeFocusContent tasks={snapshot.freeFocusTasks} nowMs={nowMs} busy={disabled} onAction={onFreeFocus} /> : <>
    <div className="tools-mode-content-pane tools-pomodoro-content">
    <form className="tools-subpanel tools-pomodoro-create" onSubmit={(event) => {
      event.preventDefault();
      if (disabled || parsed.some((value) => value === null)) return;
      const [focus, shortBreak, longBreak, every] = parsed as number[];
      void onAction({ kind: "save", id: null, label: label.trim(), focusMs: focus * 60_000,
        shortBreakMs: shortBreak * 60_000, longBreakMs: longBreak * 60_000, longBreakEvery: every }).then((ok) => {
        if (ok) setLabel("");
      });
    }}>
      <div className="tools-subpanel-header tools-reminder-subpanel-header"><div className="tools-subpanel-title-action">
        <h3>{UI_TEXT.tools.pomodoroTaskCreate}</h3>
      </div></div>
      <div className="tools-pomodoro-name-row">
        <label className="tools-form-field" htmlFor="tools-pomodoro-name"><span>{UI_TEXT.tools.pomodoroTaskName}</span>
          <input id="tools-pomodoro-name" className="qp-input" value={label} maxLength={160} disabled={disabled}
            placeholder={UI_TEXT.tools.pomodoroTaskPlaceholder} onChange={(event) => setLabel(event.target.value)} />
        </label>
        <PomodoroSettingsPicker values={values} disabled={disabled} onChange={setValues} />
        <div className="tools-action-row">
          <QuietButton type="submit" tone="primary" size="large" disabled={disabled || parsed.some((value) => value === null)}
            busy={busyAction?.startsWith("pomodoro-task:save:")}>{UI_TEXT.tools.createReminder}</QuietButton>
        </div>
      </div>
    </form>
    <div className="tools-list-section tools-reminder-list-section tools-pomodoro-task-section">
      {snapshot.pomodoroTasks.length ? <div className="tools-reminder-list-frame"><div className="tools-reminder-list qp-scroll-region qp-scroll-region-stable" role="list">
        {snapshot.pomodoroTasks.map((task) => <PomodoroTaskRow key={task.run.id} task={task} snapshot={snapshot} nowMs={nowMs}
          disabled={disabled} onEdit={() => setEditingTask(task)} onAction={onAction} />)}
      </div></div> : <div className="tools-empty-state">{UI_TEXT.tools.pomodoroTaskEmpty}</div>}
    </div>
    </div>
    {editingTask ? <PomodoroTaskEditor task={editingTask} busy={disabled} onSave={onAction}
      onClose={() => setEditingTask(null)} /> : null}
    </>}
  </section>;
}
