import { invokeWithCommandError } from "./commandError.ts";
import type { WebActivitySegment, WebDomainOverride } from "../../shared/types/webActivity.ts";
import type { WebLinkRule } from "../../shared/classification/webLinks.ts";
import { isPlainRecord } from "../../shared/lib/runtimeTypeGuards.ts";
import { isAppCategory } from "../../shared/classification/categoryTokens.ts";

export interface WebLinksSnapshot {
  segments?: WebActivitySegment[];
  /** All domains with stored activity; settings and relationship references live separately. */
  domains: string[];
  rules: Record<string, WebLinkRule>;
  overrides: Record<string, WebDomainOverride>;
}

export function parseWebLinksSnapshot(value: unknown): WebLinksSnapshot {
  if (!isPlainRecord(value) || !Array.isArray(value.domains) || !value.domains.every(domain => typeof domain === "string")
    || !isPlainRecord(value.rules) || !isPlainRecord(value.overrides)) throw new Error("Invalid website links snapshot");
  for (const rule of Object.values(value.rules)) {
    if (!isPlainRecord(rule) || !Array.isArray(rule.members) || !rule.members.every(member => typeof member === "string")
      || (rule.displayName !== undefined && typeof rule.displayName !== "string")
      || (rule.category !== undefined && typeof rule.category !== "string")
      || (rule.color !== undefined && typeof rule.color !== "string")) throw new Error("Invalid website rule");
  }
  for (const override of Object.values(value.overrides)) if (!isPlainRecord(override)) throw new Error("Invalid website override");
  return value as unknown as WebLinksSnapshot;
}

export function webLinksOverrides(snapshot: WebLinksSnapshot): Record<string, WebDomainOverride> {
  const overrides: Record<string, WebDomainOverride> = Object.fromEntries(Object.entries(snapshot.overrides).map(([domain, value]) => {
    const normalized: WebDomainOverride = {};
    if (typeof value.category === "string" && isAppCategory(value.category)) normalized.category = value.category;
    if (typeof value.displayName === "string" && value.displayName.trim()) normalized.displayName = value.displayName.trim();
    if (typeof value.color === "string") {
      const color = value.color.trim().replace(/^#?/, "#");
      if (/^#[0-9a-f]{6}$/i.test(color)) normalized.color = color.toUpperCase();
    }
    if (value.enabled === false) normalized.enabled = false;
    if (value.captureTitle === false) normalized.captureTitle = false;
    if (typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt)) normalized.updatedAt = value.updatedAt;
    return [domain.trim().replace(/\.$/, "").toLowerCase(), normalized];
  }));
  for (const domain of snapshot.domains) {
    overrides[domain] = { ...overrides[domain], knownDomain: true };
  }
  for (const [root, rule] of Object.entries(snapshot.rules)) {
    overrides[`site:${root}`] = { displayName: rule.displayName, category: rule.category, color: rule.color, siteRule: rule };
  }
  return overrides;
}

export class WebLinksReadError extends Error {}

export async function loadWebLinksOverrides(): Promise<Record<string, WebDomainOverride>> {
  try {
    return webLinksOverrides(parseWebLinksSnapshot(await invokeWithCommandError("cmd_get_web_links")));
  } catch (cause) {
    throw new WebLinksReadError(`Website grouping snapshot is unavailable: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

export async function loadWebGroupedRange(startMs: number, endMs: number, nowMs = Date.now()): Promise<{ segments: WebActivitySegment[]; overrides: Record<string, WebDomainOverride> }> {
  const snapshot = parseWebLinksSnapshot(await invokeWithCommandError("cmd_get_web_links", { startMs, endMs, nowMs }));
  if (!Array.isArray(snapshot.segments) || !snapshot.segments.every(segment => isPlainRecord(segment)
    && Number.isSafeInteger(segment.id) && typeof segment.normalizedDomain === "string"
    && typeof segment.domain === "string" && typeof segment.browserClientId === "string"
    && typeof segment.browserKind === "string" && typeof segment.browserExeName === "string"
    && Number.isSafeInteger(segment.startTime) && Number.isSafeInteger(segment.endTime)
    && Number.isSafeInteger(segment.duration)
    && (segment.url === null || typeof segment.url === "string")
    && (segment.title === null || typeof segment.title === "string"))) throw new Error("Invalid website detail snapshot");
  return { segments: snapshot.segments, overrides: webLinksOverrides(snapshot) };
}
