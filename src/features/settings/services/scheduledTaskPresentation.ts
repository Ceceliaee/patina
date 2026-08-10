export function scheduledMinutesToTime(minutes: number): string {
  const normalized = Math.max(0, Math.min(1439, Math.trunc(minutes)));
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

export function scheduledTimeToMinutes(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 120;
}

export function formatScheduledDateTime(value: number | null): string {
  if (value === null) return "";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatScheduledSize(bytes: number | null): string {
  if (bytes === null) return "";
  return `${(bytes / 1_048_576).toFixed(bytes >= 10 * 1_048_576 ? 1 : 2)} MB`;
}
