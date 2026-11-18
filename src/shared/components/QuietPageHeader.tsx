import type { ReactNode } from "react";

interface Props {
  icon: ReactNode;
  title: string;
  titleSuffix?: ReactNode;
  subtitle?: ReactNode;
  statusSlot?: ReactNode;
  rightSlot?: ReactNode;
}

export default function QuietPageHeader({
  icon,
  title,
  titleSuffix,
  subtitle,
  statusSlot,
  rightSlot,
}: Props) {
  return (
    <header className="qp-panel qp-page-header">
      <div className="qp-page-header-left">
        <div className="qp-page-header-icon">
          {icon}
        </div>
        <div className="qp-page-header-copy">
          <div className="qp-page-header-title-row">
            <h1 className="qp-page-header-title">{title}</h1>
            {titleSuffix ? titleSuffix : null}
          </div>
          {subtitle ? (
            <div className="qp-page-header-subtitle">
              {subtitle}
            </div>
          ) : null}
        </div>
      </div>
      {statusSlot}
      {rightSlot ? (
        <div className="qp-page-header-right">
          {rightSlot}
        </div>
      ) : null}
    </header>
  );
}
