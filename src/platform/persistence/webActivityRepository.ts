import { deleteWebActivitySegmentsByDomain as deleteWebActivitySegmentsByDomainViaCommand } from "./persistenceWriteRuntimeGateway.ts";
import { invokeWithCommandError } from "./commandError.ts";
import { isAnonymousActivity } from "../../shared/classification/anonymousActivity.ts";
import { loadWebLinksOverrides } from "./webLinksGateway.ts";
import type {
  ObservedWebDomainCandidate,
  WebActivitySegment,
  WebDomainOverride,
} from "../../shared/types/webActivity.ts";

interface RawWebActivitySegmentRow {
  id: number;
  browser_client_id: string;
  browser_kind: string;
  browser_exe_name: string;
  domain: string;
  normalized_domain: string;
  url: string | null;
  title: string | null;
  favicon_url: string | null;
  start_time: number;
  end_time: number | null;
  duration: number | null;
}

interface RawObservedWebDomainStatRow {
  normalized_domain: string;
  domain: string;
  total_duration: number;
  last_seen_ms: number;
  favicon_url: string | null;
  title: string | null;
}

interface RawWebFaviconRow {
  normalized_domain: string;
  favicon_url: string;
}

const WEB_FAVICON_QUERY_BATCH_SIZE = 900;

function normalizeWebDomainKey(value: string): string | null {
  const normalized = value.trim().replace(/\.$/, "").toLocaleLowerCase();
  return normalized && !isAnonymousActivity(normalized) ? normalized : null;
}

function mapRawWebActivitySegment(row: RawWebActivitySegmentRow): WebActivitySegment {
  return {
    id: row.id,
    browserClientId: row.browser_client_id,
    browserKind: row.browser_kind,
    browserExeName: row.browser_exe_name,
    domain: row.domain,
    normalizedDomain: row.normalized_domain,
    url: row.url,
    title: row.title,
    faviconUrl: row.favicon_url,
    startTime: row.start_time,
    endTime: row.end_time,
    duration: row.duration,
  };
}

export async function getWebActivitySegmentsInRange(
  startMs: number,
  endMs: number,
): Promise<WebActivitySegment[]> {
  const rows = await invokeWithCommandError<RawWebActivitySegmentRow[]>(
    "cmd_get_web_activity_segment_rows", { startMs, endMs, nowMs: Date.now() },
  );
  return rows.map(mapRawWebActivitySegment);
}

export async function deleteWebActivitySegmentsByDomain(normalizedDomain: string): Promise<void> {
  await deleteWebActivitySegmentsByDomainViaCommand(normalizedDomain);
}

export async function loadObservedWebDomainStats(
  days: number = 30,
  limit: number = 120,
): Promise<ObservedWebDomainCandidate[]> {
  const sinceMs = Date.now() - (Math.max(1, days) * 24 * 60 * 60 * 1000);
  const nowMs = Date.now();
  const rows = await invokeWithCommandError<RawObservedWebDomainStatRow[]>(
    "cmd_get_observed_web_domain_rows", { sinceMs, nowMs, limit: Math.max(1, Math.trunc(limit)) },
  );

  return rows.map((row) => ({
    normalizedDomain: row.normalized_domain,
    domain: row.domain || row.normalized_domain,
    totalDuration: row.total_duration,
    lastSeenMs: row.last_seen_ms,
    faviconUrl: row.favicon_url,
    title: row.title,
  }));
}

export async function getWebFaviconsForDomains(domains: string[]): Promise<Record<string, string>> {
  const normalizedDomains = Array.from(new Set(
    domains
      .map((domain) => normalizeWebDomainKey(domain))
      .filter((domain): domain is string => Boolean(domain)),
  ));
  const faviconMap: Record<string, string> = {};

  if (normalizedDomains.length === 0) {
    return faviconMap;
  }

  for (let index = 0; index < normalizedDomains.length; index += WEB_FAVICON_QUERY_BATCH_SIZE) {
    const batch = normalizedDomains.slice(index, index + WEB_FAVICON_QUERY_BATCH_SIZE);
    const rows = await invokeWithCommandError<RawWebFaviconRow[]>(
      "cmd_get_web_favicon_rows", { domains: batch },
    );

    for (const row of rows) {
      const domain = normalizeWebDomainKey(row.normalized_domain);
      const faviconUrl = row.favicon_url?.trim();
      if (domain && faviconUrl) {
        faviconMap[domain] = faviconUrl;
      }
    }
  }

  return faviconMap;
}

export async function loadWebDomainOverrides(): Promise<Record<string, WebDomainOverride>> {
  return loadWebLinksOverrides();
}
