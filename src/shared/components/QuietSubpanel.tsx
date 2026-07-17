import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  className?: string;
}

export default function QuietSubpanel({
  children,
  className,
}: Props) {
  return (
    <div className={`qp-subpanel ${className ?? ""}`.trim()}>
      {children}
    </div>
  );
}
