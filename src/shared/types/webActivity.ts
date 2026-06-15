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
  category?: UserAssignableAppCategory;
  displayName?: string;
  color?: string;
  enabled?: boolean;
  updatedAt?: number;
}

export interface ObservedWebDomainCandidate {
  normalizedDomain: string;
  domain: string;
  totalDuration: number;
  lastSeenMs: number;
  faviconUrl: string | null;
  title: string | null;
}
