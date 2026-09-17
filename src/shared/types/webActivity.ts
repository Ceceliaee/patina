import type { UserAssignableAppCategory } from "../classification/categoryTokens.ts";

export interface WebActivitySegment {
  id: number;
  browserClientId: string;
  browserKind: string;
  browserExeName: string;
  domain: string;
  normalizedDomain: string;
  url: string | null;
  title: string | null;
  faviconUrl: string | null;
  startTime: number;
  endTime: number | null;
  duration: number | null;
}

export interface WebDomainOverride {
  /** Stored activity exists for this domain; supplied by Rust, never persisted as a preference. */
  knownDomain?: boolean;
  /** Present only on a site: identity. Recording controls remain on raw domains. */
  siteRule?: import("../classification/webLinks.ts").WebLinkRule;
  category?: UserAssignableAppCategory;
  displayName?: string;
  color?: string;
  enabled?: boolean;
  captureTitle?: boolean;
  updatedAt?: number;
}

export interface ObservedWebDomainCandidate {
  memberCandidates?: ObservedWebDomainCandidate[];
  normalizedDomain: string;
  domain: string;
  totalDuration: number;
  lastSeenMs: number;
  faviconUrl: string | null;
  title: string | null;
}
