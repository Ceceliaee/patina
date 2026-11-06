import { ChevronRight, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { FocusGroup, FocusKind, FocusSpan } from "../../../shared/types/focusHistory.ts";
import { readFocusHistory } from "../services/toolsRuntimeService.ts";
import QuietButton from "../../../shared/components/QuietButton.tsx";
import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import QuietIconAction from "../../../shared/components/QuietIconAction.tsx";
import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import { formatCompactDuration } from "../services/toolsViewModel.ts";

interface Props {
  kind: FocusKind;
  id: number;
  name: string;
  status: string;
  updatedAt: number;
}

function phaseRows(spans: FocusSpan[]): FocusSpan[][] {
  const rows: FocusSpan[][] = [];
  for (const span of spans) {
    const previous = rows[rows.length - 1];
    const last = previous?.[previous.length - 1];
    if (!last || last.phaseFinishedAt !== null || last.cycle !== span.cycle || last.phase !== span.phase) rows.push([]);
    rows[rows.length - 1].push(span);
  }
  return rows;
}

function GroupDetails({ group, kind }: { group: FocusGroup; kind: FocusKind }) {
  const { tools } = useLocaleText();
  const locale = useLocale();
  const date = (t: number) => new Date(t).toLocaleDateString(locale);
  const clock = (t: number, exact = false) => new Date(t).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: exact ? "2-digit" : undefined, hour12: false });
  const stamp = (t: number, exact = false) => (date(t) === date(group.startedAt) ? "" : date(t) + " ") + clock(t, exact);
  return <details className="tools-history-group">
    <summary>{date(group.startedAt)} {clock(group.startedAt)}<small>{group.outcome === "open" ? tools.focusHistoryOpen
      : group.outcome === "completed" ? tools.pomodoroStatus.completed : tools.focusHistoryEnded}</small></summary>
    {phaseRows(group.spans).map((parts, index) => {
      const start = parts[0], last = parts[parts.length - 1];
      const end = last.phaseFinishedAt ?? last.endedAt;
      const phase = start.phase === "break" ? tools.freeFocusRest : start.phase === "short_break"
        ? tools.pomodoroPhase.shortBreak : start.phase === "long_break" ? tools.pomodoroPhase.longBreak : tools.pomodoroPhase.focus;
      const rangeText = (exact: boolean) => stamp(start.startedAt, exact) + " – " + (end === null ? tools.focusHistoryOpen : stamp(end, exact));
      const sameMinute = end !== null && Math.floor(end / 60000) === Math.floor(start.startedAt / 60000);
      const range = <time title={rangeText(true)}>{rangeText(sameMinute)}</time>;
      const label = <span>{phase}{kind === "pomodoro" && start.phase === "focus" && <small>{start.cycle}/{start.rounds}</small>}</span>;
      const elapsed = parts.reduce((ms, span) => ms + Math.max(0, (span.endedAt ?? Date.now()) - span.startedAt), 0);
      return <div className="tools-history-phase" key={index}>
        <div>{label}{range}</div>
        {parts.length > 1 ? <details><summary>{formatCompactDuration(elapsed)}</summary>{parts.map((span,index) =>
          <time key={index}>{stamp(span.startedAt, true)} – {span.endedAt === null ? tools.focusHistoryOpen : stamp(span.endedAt, true)}</time>)}</details> : null}
      </div>;
    })}
  </details>;
}

export default function FocusHistoryButton({ kind, id, name, status, updatedAt }: Props) {
  const text = useLocaleText();
  const [request, setRequest] = useState(0);
  const [groups, setGroups] = useState<FocusGroup[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!request) return;
    let current = true;
    readFocusHistory(kind, id).then(rows => { if (current) { setGroups(rows); setFailed(false); } })
      .catch(() => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [request, kind, id, updatedAt]);
  const pending = request > 0 && groups === null && !failed;
  const close = () => { setRequest(0); setGroups(null); setFailed(false); };
  return <>
    <button type="button" className="tools-history-trigger" aria-haspopup="dialog" aria-busy={pending || undefined}
      aria-label={name + " · " + status + " · " + text.tools.focusDetails}
      onBlur={() => { if (pending) close(); }}
      onKeyDown={event => { if (pending && event.key === "Escape") close(); }}
      onClick={() => setRequest(1)}>{status}<ChevronRight size={13} aria-hidden="true" /></button>
    {request > 0 && !pending && <QuietDialog open title={name} surfaceClassName="tools-history-dialog"
      onClose={close} headerAside={<QuietIconAction title={text.common.close} icon={<X size={16} aria-hidden />}
        className="qp-dialog-close-button" showTooltip={false} onClick={close} />}>
    {failed && <div role="alert">{text.tools.focusHistoryError} <QuietButton onClick={() => setRequest(value => value + 1)}>{text.common.retry}</QuietButton></div>}
    {groups?.length === 0 && <p>{text.tools.focusHistoryEmpty}</p>}
    {groups?.map(group => <GroupDetails key={group.key} group={group} kind={kind} />)}
    </QuietDialog>}
  </>;
}
