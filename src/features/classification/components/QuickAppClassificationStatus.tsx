import { useLocaleText } from "../../../shared/i18n/index.ts";
import QuietBadge from "../../../shared/components/QuietBadge.tsx";


interface Props {
  density?: "dense" | "standard";
  unclassified: boolean;
}

export default function QuickAppClassificationStatus({
  density = "standard",
  unclassified,
}: Props) {
  const UI_TEXT = useLocaleText();
  if (!unclassified) return null;
  return (
    <QuietBadge tone="neutral" size={density === "dense" ? "inline" : "regular"}>
      {UI_TEXT.mapping.quickUnclassified}
    </QuietBadge>
  );
}
