import QuietBadge from "../../../shared/components/QuietBadge.tsx";
import { UI_TEXT } from "../../../shared/copy/index.ts";

interface Props {
  density?: "dense" | "standard";
  unclassified: boolean;
}

export default function QuickAppClassificationStatus({
  density = "standard",
  unclassified,
}: Props) {
  if (!unclassified) return null;
  return (
    <QuietBadge tone="neutral" size={density === "dense" ? "inline" : "regular"}>
      {UI_TEXT.mapping.quickUnclassified}
    </QuietBadge>
  );
}
