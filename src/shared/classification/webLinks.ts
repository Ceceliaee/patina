import type { ObservedWebDomainCandidate, WebDomainOverride } from "../types/webActivity.ts";

export interface WebLinkRule {
  members: string[];
  displayName?: string;
  category?: WebDomainOverride["category"];
  color?: string;
}

export const WEB_LINK_GROUP_PREFIX = "site:";
export const WEB_LINK_SETTING_PREFIX = "__web_site::";

export function webLinkParent(identity: string): string | null {
  return identity.startsWith(WEB_LINK_GROUP_PREFIX) ? identity.slice(WEB_LINK_GROUP_PREFIX.length) : null;
}

export function webDisplayDomain(identity: string): string {
  return webLinkParent(identity) ?? identity;
}

// Draft updates and loaded snapshots replace the override object instead of mutating it.
const ownerIndexes = new WeakMap<Record<string, WebDomainOverride>, Map<string, string>>();

export function resolveWebOwner(domain: string, overrides: Record<string, WebDomainOverride>): string {
  if (webLinkParent(domain)) return domain;
  let index = ownerIndexes.get(overrides);
  if (!index) {
    index = new Map();
    for (const [key, value] of Object.entries(overrides)) {
      const parent = webLinkParent(key), rule = value.siteRule;
      if (!parent || !rule?.members) continue;
      index.set(parent, key);
      for (const member of rule.members) index.set(member, key);
    }
    ownerIndexes.set(overrides, index);
  }
  return index.get(domain) ?? domain;
}

export function siteRuleFromOverride(override: WebDomainOverride | null | undefined): WebLinkRule | null {
  if (!override?.siteRule) return null;
  return {
    members: [...override.siteRule.members].sort(),
    ...(override.displayName?.trim() ? { displayName: override.displayName.trim() } : {}),
    ...(override.category ? { category: override.category } : {}),
    ...(override.color ? { color: override.color } : {}),
  };
}

export function refreshKnownWebDomains(current: Record<string, WebDomainOverride>, fresh: Record<string, WebDomainOverride>): Record<string, WebDomainOverride> {
  const next = { ...current };
  for (const [domain, override] of Object.entries(current)) {
    next[domain] = { ...override, knownDomain: fresh[domain]?.knownDomain };
    if (!fresh[domain] && !webLinkParent(domain) && !override.displayName && !override.category && !override.color
      && override.enabled !== false && override.captureTitle !== false) delete next[domain];
  }
  for (const [domain, override] of Object.entries(fresh)) {
    if (!webLinkParent(domain) && !next[domain]) next[domain] = { ...override };
  }
  return next;
}

export function groupWebCandidates(candidates: readonly ObservedWebDomainCandidate[], overrides: Record<string, WebDomainOverride>): ObservedWebDomainCandidate[] {
  const all = new Map(candidates.map(candidate => [candidate.normalizedDomain, candidate]));
  const include = (domain: string) => {
    if (!all.has(domain)) all.set(domain, { normalizedDomain: domain, domain, totalDuration: 0, lastSeenMs: 0, faviconUrl: null, title: null });
  };
  for (const [domain, override] of Object.entries(overrides)) {
    if (!webLinkParent(domain) && (override.knownDomain || override.enabled === false)) {
      include(domain);
    }
    const parent = webLinkParent(domain);
    if (parent && override.siteRule) {
      include(parent);
      override.siteRule.members.forEach(include);
    }
  }
  const grouped = new Map<string, ObservedWebDomainCandidate>();
  for (const candidate of all.values()) {
    const key = resolveWebOwner(candidate.normalizedDomain, overrides);
    const current = grouped.get(key);
    if (current) {
      current.totalDuration += overrides[candidate.normalizedDomain]?.enabled === false ? 0 : candidate.totalDuration;
      current.lastSeenMs = Math.max(current.lastSeenMs, candidate.lastSeenMs);
      current.memberCandidates?.push(candidate);
    } else {
      grouped.set(key, webLinkParent(key) ? { ...candidate, normalizedDomain: key, domain: webDisplayDomain(key), totalDuration: overrides[candidate.normalizedDomain]?.enabled === false ? 0 : candidate.totalDuration, memberCandidates: [candidate] } : { ...candidate });
    }
  }
  for (const candidate of grouped.values()) {
    if (candidate.memberCandidates) {
      const root = webLinkParent(candidate.normalizedDomain);
      const members = [...candidate.memberCandidates].sort((a, b) =>
        Number(b.normalizedDomain === root) - Number(a.normalizedDomain === root)
        || a.normalizedDomain.localeCompare(b.normalizedDomain));
      candidate.faviconUrl = members.find(member => member.faviconUrl?.trim())?.faviconUrl?.trim() ?? null;
    }
  }
  return [...grouped.values()];
}
