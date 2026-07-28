import type { CSSProperties, ReactNode } from "react";

export interface QuietChartTooltipItem {
  color?: string;
  key: string;
  name: ReactNode;
  value: ReactNode;
}

interface Props {
  fixedBottom?: boolean;
  items: readonly QuietChartTooltipItem[];
  label?: ReactNode;
  style?: CSSProperties;
}

export default function QuietChartTooltip({
  fixedBottom = false,
  items,
  label,
  style,
}: Props) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div
      className={`qp-chart-tooltip${fixedBottom ? " qp-chart-tooltip-fixed-bottom" : ""}`}
      role="tooltip"
      style={style}
    >
      {label !== null && label !== undefined && label !== "" ? (
        <div className="qp-chart-tooltip-label">{label}</div>
      ) : null}
      <ul className="qp-chart-tooltip-list">
        {items.map((item) => (
          <li key={item.key} className="qp-chart-tooltip-item">
            <span className="qp-chart-tooltip-key">
              <span
                className="qp-chart-tooltip-dot"
                style={{ backgroundColor: item.color ?? "var(--qp-accent-default)" }}
              />
              <span className="qp-chart-tooltip-name">{item.name}</span>
            </span>
            <span className="qp-chart-tooltip-value">{item.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
