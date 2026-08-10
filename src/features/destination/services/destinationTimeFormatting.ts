import type { Locale } from "../../../shared/i18n/index.ts";

export function formatDestinationTime(timestamp: number, dayEndMs: number, locale: Locale): string {
  if (timestamp === dayEndMs) return "24:00";
  return new Date(timestamp).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
