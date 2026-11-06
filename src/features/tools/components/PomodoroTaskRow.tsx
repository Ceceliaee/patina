import { Badge, Pause, PencilLine, Play, Trash2 } from "lucide-react";
import QuietIconAction from "../../../shared/components/QuietIconAction.tsx";
import FocusHistoryButton from "./FocusHistoryButton.tsx";
import QuietTooltip from "../../../shared/components/QuietTooltip.tsx";
import { useLocaleText } from "../../../shared/i18n/index.ts";
import type { PomodoroTaskAction, ToolPomodoroTask, ToolsRuntimeSnapshot } from "../../../shared/types/tools.ts";
import { buildPomodoroViewModel } from "../services/toolsViewModel.ts";
import { buildToolsViewModelLabels } from "../services/toolsLabels.ts";

interface PomodoroTaskRowProps {
  task: ToolPomodoroTask;
  snapshot: ToolsRuntimeSnapshot;
  nowMs: number;
  disabled: boolean;
  onEdit: () => void;
  onAction: (action: PomodoroTaskAction) => Promise<boolean>;
}

export default function PomodoroTaskRow({ task, snapshot, nowMs, disabled, onEdit, onAction }: PomodoroTaskRowProps) {
  const UI_TEXT = useLocaleText();
  const run = task.run;
  const running = run.status === "running";
  const completed = run.status === "completed";
  const idle = run.status === "idle" || run.status === "completed";
  const view = buildPomodoroViewModel({ ...snapshot, currentPomodoro: run }, nowMs, buildToolsViewModelLabels(UI_TEXT));
  const name = task.label || UI_TEXT.tools.pomodoroTaskDefault;
  const act = (kind: "resume" | "pause") => void onAction({ kind, id: run.id });
  return <article className="tools-reminder-row tools-pomodoro-task-row" role="listitem" aria-label={name} data-pomodoro-task-id={run.id}>
    <div className="tools-reminder-row-main tools-pomodoro-task-details">
      <strong title={name}>{name}</strong>
      {task.completedGroups > 0 ? <QuietTooltip label={UI_TEXT.tools.pomodoroCompletedGroups(task.completedGroups)}>
        <span className="tools-pomodoro-completed-badge" role="img" aria-label={UI_TEXT.tools.pomodoroCompletedGroups(task.completedGroups)}>
          <Badge aria-hidden="true" preserveAspectRatio="none" />
          <span aria-hidden="true">{task.completedGroups}</span>
        </span>
      </QuietTooltip> : null}
      <div className="tools-pomodoro-task-time">
        <strong>{view.remainingLabel}</strong>
        <FocusHistoryButton kind="pomodoro" id={run.id} name={name} updatedAt={run.updatedAt}
          status={completed ? UI_TEXT.tools.pomodoroStatus.completed : idle ? UI_TEXT.tools.pomodoroStatus.idle : view.phaseLabel} />
      </div>
    </div>
    <div className="tools-action-row tools-pomodoro-task-actions">
      <QuietIconAction className="tools-pomodoro-run-button" busy={disabled} onClick={() => act(running ? "pause" : "resume")}
        title={running ? UI_TEXT.accessibility.tools.pausePomodoro : idle ? UI_TEXT.accessibility.tools.startPomodoro : UI_TEXT.accessibility.tools.resumePomodoro}
        icon={running ? <Pause size={16} /> : <Play size={16} />} />
      <QuietIconAction busy={disabled} disabled={running} title={UI_TEXT.tools.activityReminderEdit} onClick={onEdit} icon={<PencilLine size={16} />} />
      <QuietIconAction busy={disabled} tone="danger" title={UI_TEXT.tools.activityReminderDelete} onClick={() => void onAction({ kind: "delete", id: run.id })} icon={<Trash2 size={16} />} />
    </div>
  </article>;
}
