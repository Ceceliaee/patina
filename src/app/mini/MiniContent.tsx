import type { useMiniTracking } from "./useMiniTracking.ts";
import { useLocaleText } from "../../shared/i18n/index.ts";
import MiniActivityContent from "./MiniActivityContent.tsx";

export default function MiniContent({ tracking }: {
  tracking: ReturnType<typeof useMiniTracking>;
}) {
  const text = useLocaleText();
  if (!tracking.presentationReady) return <div className="mini-content mini-empty" role={tracking.presentationFailed ? "alert" : "status"}>
    {tracking.presentationFailed ? <><span>{text.miniWindow.failed}</span><button className="qp-button qp-button-secondary" onClick={tracking.retry}>{text.common.retry}</button></> : text.common.loading}
  </div>;
  return <MiniActivityContent health={tracking.trackerHealth} />;
}
