import type { ObservedWebDomainCandidate, WebDomainOverride } from "../types/webActivity.ts";

export interface WebLinkRule {
  version: 2;
  exceptions: string[];
  displayName?: string;
  category?: WebDomainOverride["category"];
  color?: string;
}
export const WEB_LINK_SETTING_PREFIX = "__web_site::";
// Maps need string keys; serialize the target type without changing its domain.
export function webGroupKey(domain: string): string { return JSON.stringify({ kind: "group", domain }); }
export function webLinkParent(identity: string): string | null {
  if (!identity.startsWith("{")) return null;
  try {
    const value: unknown = JSON.parse(identity);
    if (value && typeof value === "object" && "kind" in value && "domain" in value
      && value.kind === "group" && typeof value.domain === "string"
      && webGroupKey(value.domain) === identity) return value.domain;
  } catch { /* Malformed targets never identify a group. */ }
  return null;
}
export function webDisplayDomain(identity: string): string { return webLinkParent(identity) ?? identity; }
export function resolveWebOwner(domain: string, overrides: Record<string, WebDomainOverride>): string {
  if (webLinkParent(domain)) return domain;
  const root = overrides[domain]?.groupingRoot;
  if (!root) return domain;
  const key = webGroupKey(root);
  return overrides[key]?.siteRule?.exceptions.includes(domain) ? domain : key;
}
export function siteRuleFromOverride(override: WebDomainOverride | null | undefined): WebLinkRule | null {
  if (!override?.siteRule) return null;
  if (!override.siteRule.exceptions.length && !override.displayName?.trim() && !override.category && !override.color) return null;
  return { version: 2, exceptions: [...override.siteRule.exceptions].sort(),
    ...(override.displayName?.trim() ? { displayName: override.displayName.trim() } : {}),
    ...(override.category ? { category: override.category } : {}),
    ...(override.color ? { color: override.color } : {}) };
}
export function setWebDomainIndependent(domain: string, independent: boolean, overrides: Record<string, WebDomainOverride>): { key: string; override: WebDomainOverride } | null {
  const root = overrides[domain]?.groupingRoot;
  if (!root) return null;
  const key = webGroupKey(root), current = overrides[key] ?? {};
  const exceptions = new Set(current.siteRule?.exceptions ?? []);
  if (independent) exceptions.add(domain); else exceptions.delete(domain);
  return { key, override: { ...current, siteRule: { version: 2, exceptions: [...exceptions].sort() } } };
}
export function refreshKnownWebDomains(current: Record<string, WebDomainOverride>, fresh: Record<string, WebDomainOverride>): Record<string, WebDomainOverride> {
  const next = { ...current };
  for (const [domain, override] of Object.entries(current)) {
    next[domain] = { ...override, knownDomain: fresh[domain]?.knownDomain,
      groupingRoot: fresh[domain]?.groupingRoot, lifetimeDuration: fresh[domain]?.lifetimeDuration, faviconUrl: fresh[domain]?.faviconUrl };
    if (!fresh[domain] && !webLinkParent(domain) && !override.displayName && !override.category && !override.color
      && override.enabled !== false && override.captureTitle !== false) delete next[domain];
  }
  for (const [domain, override] of Object.entries(fresh)) if (!next[domain]) next[domain] = { ...override };
  return next;
}
const iconIndexes = new WeakMap<Record<string, WebDomainOverride>, Map<string, string>>();
export function webGroupIcon(identity: string, overrides: Record<string, WebDomainOverride>): string | null {
  let index = iconIndexes.get(overrides);
  if (!index) {
    index = new Map();
    const members = Object.entries(overrides).filter(([domain, value]) => !webLinkParent(domain)
      && value.knownDomain && value.enabled !== false && value.faviconUrl?.trim());
    members.sort(([a, av], [b, bv]) => (bv.lifetimeDuration ?? 0) - (av.lifetimeDuration ?? 0) || (a < b ? -1 : a > b ? 1 : 0));
    for (const [domain, value] of members) {
      const owner = resolveWebOwner(domain, overrides);
      if (!index.has(owner)) index.set(owner, value.faviconUrl!.trim());
    }
    iconIndexes.set(overrides, index);
  }
  return index.get(identity) ?? null;
}
export function groupWebCandidates(candidates: readonly ObservedWebDomainCandidate[], overrides: Record<string, WebDomainOverride>): ObservedWebDomainCandidate[] {
  const all = new Map(candidates.map(candidate => [candidate.normalizedDomain, candidate]));
  for (const [domain, override] of Object.entries(overrides)) {
    if (!webLinkParent(domain) && (override.knownDomain || override.enabled === false) && !all.has(domain)) {
      all.set(domain, { normalizedDomain: domain, domain, totalDuration: override.lifetimeDuration ?? 0,
        lastSeenMs: 0, faviconUrl: override.faviconUrl ?? null, title: null });
    }
  }
  const grouped = new Map<string, ObservedWebDomainCandidate>();
  for (const candidate of all.values()) {
    const key = resolveWebOwner(candidate.normalizedDomain, overrides);
    const duration = overrides[candidate.normalizedDomain]?.enabled === false ? 0 : candidate.totalDuration;
    const current = grouped.get(key);
    if (current) {
      current.totalDuration += duration;
      current.lastSeenMs = Math.max(current.lastSeenMs, candidate.lastSeenMs);
      current.memberCandidates?.push(candidate);
    } else {
      grouped.set(key, webLinkParent(key) ? { ...candidate, normalizedDomain: key, domain: webDisplayDomain(key),
        totalDuration: duration, memberCandidates: [candidate] } : { ...candidate });
    }
  }
  for (const candidate of grouped.values()) if (candidate.memberCandidates) {
    candidate.memberCandidates.sort((a, b) => a.normalizedDomain.localeCompare(b.normalizedDomain));
    candidate.faviconUrl = webGroupIcon(candidate.normalizedDomain, overrides);
  }
  return [...grouped.values()];
}
