import { useEffect, useState } from "react";
import { useLocaleText } from "../../shared/i18n/index.ts";
import ToolStatusButtons from "../../features/tools/components/ToolStatusButtons.tsx";
import { buildToolStatusEntries } from "../../features/tools/services/toolStatusEntries.ts";
import type { ToolsOpenTarget } from "../../features/tools/types.ts";
import type { useMiniTracking } from "./useMiniTracking.ts";

export default function MiniToolStatus({ tracking, onOpenSection }: {
  tracking: ReturnType<typeof useMiniTracking>;
  onOpenSection: (target: ToolsOpenTarget) => void;
}) {
  const text = useLocaleText();
  const [clock, setClock] = useState({ snapshot: tracking.miniStatus, elapsed: 0 });
  useEffect(() => {
    if (tracking.presentationFailed) return;
    const snapshot = tracking.miniStatus;
    const start = performance.now();
    setClock({ snapshot, elapsed: 0 });
    if (!snapshot?.reminder && !snapshot?.tools.some(tool => tool.state === "running")) return;
    const timer = window.setInterval(() => setClock({ snapshot, elapsed: performance.now() - start }), 1000);
    return () => window.clearInterval(timer);
  }, [tracking.miniStatus, tracking.presentationFailed]);
  if (!tracking.presentationReady || !tracking.miniStatus) return null;
  const entries = buildToolStatusEntries({ timer: tracking.miniStatus.tools[0] ?? null, reminder: tracking.miniStatus.reminder },
    clock.snapshot === tracking.miniStatus ? clock.elapsed : 0, Date.now(), {
      chipFocus: text.tools.statusChip.focus, chipBreak: text.tools.statusChip.break, chipReminder: text.tools.statusChip.reminder,
    });
  return <ToolStatusButtons entries={entries} onOpenSection={onOpenSection} />;
}
