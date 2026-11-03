import { Pause, PencilLine, Play, RotateCcw, Square, Trash2 } from "lucide-react";
import { useState } from "react";
import QuietButton from "../../../shared/components/QuietButton.tsx";
import QuietIconAction from "../../../shared/components/QuietIconAction.tsx";
import { useLocaleText } from "../../../shared/i18n/index.ts";
import type { FreeFocusAction, FreeFocusSettings, FreeFocusTask } from "../../../shared/types/tools.ts";
import { freeFocusTime } from "../services/freeFocusViewModel.ts";
import FreeFocusRestPicker from "./FreeFocusRestPicker.tsx";
import FreeFocusTaskEditor from "./FreeFocusTaskEditor.tsx";

interface Props { tasks: FreeFocusTask[]; nowMs: number; busy: boolean; onAction: (action: FreeFocusAction) => Promise<boolean> }
export default function FreeFocusContent({ tasks, nowMs, busy, onAction }: Props) {
  const text = useLocaleText();
  const [label, setLabel] = useState("");
  const [settings, setSettings] = useState<FreeFocusSettings>({ restMode: "fixed", restMinutes: 5, restRatio: 5 });
  const [editing, setEditing] = useState<FreeFocusTask | null>(null);
  return <>
    <div className="tools-mode-content-pane tools-pomodoro-content tools-free-focus-content">
      <form className="tools-subpanel tools-pomodoro-create" onSubmit={event => { event.preventDefault(); if (busy) return;
        void onAction({ kind: "save", id: null, label: label.trim(), ...settings }).then(ok => { if (ok) setLabel(""); }); }}>
        <div className="tools-subpanel-header tools-reminder-subpanel-header"><h3>{text.tools.pomodoroTaskCreate}</h3></div>
        <div className="tools-pomodoro-name-row">
          <label className="tools-form-field"><span>{text.tools.pomodoroTaskName}</span><input className="qp-input" value={label} maxLength={160}
            disabled={busy} placeholder={text.tools.pomodoroTaskPlaceholder} onChange={e => setLabel(e.target.value)} /></label>
          <FreeFocusRestPicker value={settings} disabled={busy} onChange={setSettings} />
          <div className="tools-action-row"><QuietButton type="submit" tone="primary" size="large" disabled={busy}>{text.tools.createReminder}</QuietButton></div>
        </div>
      </form>
      <div className="tools-list-section tools-reminder-list-section tools-pomodoro-task-section">
        {tasks.length ? <div className="tools-reminder-list-frame"><div className="tools-reminder-list qp-scroll-region qp-scroll-region-stable" role="list">
          {tasks.map(task => {
            const running = task.status === "running", idle = task.status === "idle", completed = task.status === "completed";
            const name = task.label || text.tools.focusModeFree;
            const runTitle = running ? text.tools.freeFocusPause : completed ? text.tools.freeFocusRestart : idle ? text.tools.freeFocusStart : text.tools.freeFocusResume;
            return <article key={task.id} className="tools-reminder-row tools-pomodoro-task-row" role="listitem" aria-label={name} data-free-focus-id={task.id}>
              <div className="tools-reminder-row-main tools-pomodoro-task-details"><strong title={name}>{name}</strong>
                <div className="tools-pomodoro-task-time"><strong>{freeFocusTime(task, nowMs)}</strong><span>{completed ? text.tools.pomodoroStatus.completed : idle ? text.tools.pomodoroStatus.idle : task.phase === "break" ? text.tools.freeFocusRest : text.tools.pomodoroPhase.focus}</span></div>
              </div>
              <div className="tools-action-row tools-pomodoro-task-actions">
                <QuietIconAction disabled={busy} title={runTitle} icon={running ? <Pause size={15} /> : <Play size={15} />} onClick={() => void onAction({ kind: running ? "pause" : "resume", id: task.id })} />
                {!idle && !completed && task.phase === "focus" ? <QuietIconAction disabled={busy} title={text.tools.freeFocusFinish} icon={<Square size={15} />} onClick={() => void onAction({ kind: "finish", id: task.id })} /> : null}
                {!idle && !completed ? <QuietIconAction disabled={busy} title={text.tools.freeFocusReset} icon={<RotateCcw size={15} />} onClick={() => void onAction({ kind: "reset", id: task.id })} /> : null}
                <QuietIconAction disabled={busy || running} title={text.tools.freeFocusEdit} icon={<PencilLine size={16} />} onClick={() => setEditing(task)} />
                <QuietIconAction disabled={busy} tone="danger" title={text.tools.activityReminderDelete} icon={<Trash2 size={15} />} onClick={() => void onAction({ kind: "delete", id: task.id })} />
              </div>
            </article>;
          })}
        </div></div> : <div className="tools-empty-state">{text.tools.freeFocusEmpty}</div>}
      </div>
    </div>
    {editing ? <FreeFocusTaskEditor task={editing} busy={busy} onSave={onAction} onClose={() => setEditing(null)} /> : null}
  </>;
}
