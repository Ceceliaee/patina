import type { ReactNode } from "react";

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

export function SettingsPreferenceRow({ title, children }: {
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="settings-preference-row">
      <div className="settings-preference-copy">
        <div className="settings-preference-title">
          {title}
        </div>
      </div>
      <div className="settings-preference-control">{children}</div>
    </div>
  );
}
