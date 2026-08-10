function containsCjkCharacters(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value);
}

export function scoreDisplayNameForStats(name: string): number {
  const normalized = name.trim();
  if (!normalized) return 0;

  const lower = normalized.toLowerCase();
  if (lower.includes("tray") || lower.includes("widget")) return 1;
  if (containsCjkCharacters(normalized)) return 4;
  if (lower.includes("_") || lower.includes("-")) return 2;
  return 3;
}

export function pickPreferredAppName(current: string, next: string): string {
  return scoreDisplayNameForStats(next) > scoreDisplayNameForStats(current) ? next : current;
}
