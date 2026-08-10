const DOMAIN_COLOR_PALETTE = [
  "#36AC7E",
  "#4790CF",
  "#6F7AE6",
  "#B07E55",
  "#35A69E",
  "#C56A73",
  "#8C6FA1",
] as const;

export function resolveStableDomainColor(normalizedDomain: string): string {
  let hash = 0;
  for (const char of normalizedDomain) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return DOMAIN_COLOR_PALETTE[hash % DOMAIN_COLOR_PALETTE.length];
}
