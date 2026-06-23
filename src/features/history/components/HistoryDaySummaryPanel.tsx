export interface HistoryDaySummaryView {
  activeDurationLabel: string;
  activeSpanLabel: string;
  peakHourLabel: string;
}

interface HistoryDaySummaryCopy {
  daySummary: string;
  activeDuration: string;
  activeSpan: string;
  peakHour: string;
}

interface HistoryDaySummaryPanelProps {
  copy: HistoryDaySummaryCopy;
  view: HistoryDaySummaryView;
}

export default function HistoryDaySummaryPanel({ copy, view }: HistoryDaySummaryPanelProps) {
  return (
    <div className="qp-panel p-5 history-day-summary-card">
      <h3 className="font-semibold text-[var(--qp-text-primary)] text-sm">{copy.daySummary}</h3>
      <div className="history-day-summary-body">
        <div className="history-day-summary-primary">
          <span className="history-day-summary-label">{copy.activeDuration}</span>
          <strong className="history-day-summary-value">{view.activeDurationLabel}</strong>
        </div>
        <div className="history-day-summary-details">
          <div className="history-day-summary-detail">
            <span>{copy.activeSpan}</span>
            <strong>{view.activeSpanLabel}</strong>
          </div>
          <div className="history-day-summary-detail">
            <span>{copy.peakHour}</span>
            <strong>{view.peakHourLabel}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
