import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import QuietTooltip from "../../../shared/components/QuietTooltip";

export function SettingsPreferenceGroup({ title, children, headerAside, className = "" }: {
  title: ReactNode;
  children?: ReactNode;
  headerAside?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`settings-preference-group ${className}`.trim()}>
      <div className="settings-preference-group-header">
        <h3 className="settings-preference-group-title">{title}</h3>
        {headerAside}
      </div>
      {children}
    </div>
  );
}

export function SettingsPreferenceRow({ title, hint, children, stacked = false }: {
  title: ReactNode;
  hint?: string;
  children: ReactNode;
  stacked?: boolean;
}) {
  return (
    <div className={`settings-preference-row${stacked ? " settings-preference-row-responsive" : ""}`}>
      <div className="settings-preference-copy">
        <div className="settings-preference-title">
          {title}
          {hint ? (
            <QuietTooltip label={hint} placement="top" tooltipClassName="settings-help-tooltip">
              <button type="button" className="settings-help-icon" aria-label={hint}>
                <CircleAlert size={13} aria-hidden="true" />
              </button>
            </QuietTooltip>
          ) : null}
        </div>
      </div>
      <div className="settings-preference-control">{children}</div>
    </div>
  );
}
