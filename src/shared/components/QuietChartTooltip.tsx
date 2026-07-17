import type { ReactNode } from "react";
import {
  Tooltip,
  type TooltipContentProps,
  type TooltipPayloadEntry,
  type TooltipProps,
  type TooltipValueType,
} from "recharts";

type TooltipName = number | string;
type ChartTooltipPayloadEntry = TooltipPayloadEntry<TooltipValueType, TooltipName>;
type ChartTooltipPayload = readonly ChartTooltipPayloadEntry[];

type TooltipFormatter = (
  value: TooltipValueType | undefined,
  name: TooltipName | undefined,
  item: ChartTooltipPayloadEntry,
  index: number,
  payload: ChartTooltipPayload,
) => ReactNode | [ReactNode, ReactNode];

type TooltipLabelFormatter = (label: ReactNode, payload: ChartTooltipPayload) => ReactNode;
type TooltipColorFormatter = (
  item: ChartTooltipPayloadEntry,
  index: number,
  payload: ChartTooltipPayload,
) => string | undefined;

interface Props {
  cursor?: TooltipProps<TooltipValueType, TooltipName>["cursor"];
  formatter?: TooltipFormatter;
  labelFormatter?: TooltipLabelFormatter;
  colorFormatter?: TooltipColorFormatter;
  filterZeroValues?: boolean;
  reverseItems?: boolean;
  verticalPlacement?: "default" | "fixed-bottom";
  fixedBottomY?: number;
}

function formatTooltipItem(
  formatter: TooltipFormatter | undefined,
  item: ChartTooltipPayloadEntry,
  index: number,
  payload: ChartTooltipPayload,
): { value: ReactNode; name: ReactNode } {
  const baseValue = item.value;
  const baseName = item.name ?? String(item.dataKey ?? "");
  if (!formatter) {
    return {
      value: Array.isArray(baseValue) ? baseValue.join(" – ") : String(baseValue ?? ""),
      name: baseName,
    };
  }
  const formatted = formatter(baseValue, baseName, item, index, payload);
  if (Array.isArray(formatted)) {
    const [nextValue, nextName] = formatted;
    return {
      value: nextValue ?? "",
      name: nextName ?? baseName,
    };
  }
  return { value: formatted ?? "", name: baseName };
}

function resolveTooltipLabel(
  label: ReactNode,
  payload: ChartTooltipPayload,
  labelFormatter?: TooltipLabelFormatter,
): ReactNode {
  if (label === undefined || label === null) {
    return null;
  }
  if (!labelFormatter) {
    return String(label);
  }
  return labelFormatter(label, payload);
}

function isZeroTooltipValue(value: TooltipValueType | undefined): boolean {
  if (Array.isArray(value)) {
    return value.length > 0 && value.every(isZeroTooltipValue);
  }
  if (typeof value === "string" && value.trim() === "") return false;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue === 0;
}

export default function QuietChartTooltip({
  cursor,
  formatter,
  labelFormatter,
  colorFormatter,
  filterZeroValues = false,
  reverseItems = false,
  verticalPlacement = "default",
  fixedBottomY,
}: Props) {
  const useFixedBottom = verticalPlacement === "fixed-bottom" && fixedBottomY !== undefined;

  return (
    <Tooltip
      cursor={cursor}
      position={useFixedBottom ? { y: fixedBottomY } : undefined}
      content={(contentProps: TooltipContentProps<TooltipValueType, TooltipName>) => {
        const { active, payload, label } = contentProps;
        if (!active || !payload || payload.length === 0) {
          return null;
        }

        const visiblePayload = payload
          .filter((item) => !filterZeroValues || !isZeroTooltipValue(item.value));
        if (visiblePayload.length === 0) {
          return null;
        }
        const orderedPayload = reverseItems ? [...visiblePayload].reverse() : visiblePayload;
        const resolvedLabel = resolveTooltipLabel(label, orderedPayload, labelFormatter);

        return (
          <div
            className={`qp-chart-tooltip${useFixedBottom ? " qp-chart-tooltip-fixed-bottom" : ""}`}
            role="tooltip"
          >
            {resolvedLabel !== null && resolvedLabel !== undefined && resolvedLabel !== "" ? (
              <div className="qp-chart-tooltip-label">{resolvedLabel}</div>
            ) : null}
            <ul className="qp-chart-tooltip-list">
              {orderedPayload.map((item, index) => {
                const { name, value } = formatTooltipItem(formatter, item, index, orderedPayload);
                return (
                  <li key={`${item.dataKey ?? item.name ?? "item"}-${index}`} className="qp-chart-tooltip-item">
                    <span className="qp-chart-tooltip-key">
                      <span
                        className="qp-chart-tooltip-dot"
                        style={{ backgroundColor: colorFormatter?.(item, index, orderedPayload)
                          ?? item.color
                          ?? "var(--qp-accent-default)" }}
                      />
                      <span className="qp-chart-tooltip-name">{name}</span>
                    </span>
                    <span className="qp-chart-tooltip-value">{value}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      }}
    />
  );
}
