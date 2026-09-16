import { deleteWebActivitySegmentsByDomain as deleteWebActivitySegmentsByDomainViaCommand } from "./persistenceWriteRuntimeGateway.ts";
import { getDB } from "./sqlite.ts";
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
  return normalized ? normalized : null;
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
  const db = await getDB();
  const now = Date.now();
  const rows = await db.select<RawWebActivitySegmentRow[]>(
    `SELECT id,
            browser_client_id,
            browser_kind,
            browser_exe_name,
            domain,
            normalized_domain,
            url,
            title,
            NULL AS favicon_url,
            start_time,
            COALESCE(end_time, MAX(start_time, MIN(?, updated_at + 45000))) AS end_time,
            COALESCE(duration, MAX(0, MIN(?, updated_at + 45000) - start_time)) AS duration
     FROM web_activity_segments
     WHERE start_time < ?
       AND COALESCE(end_time, MIN(?, updated_at + 45000)) > ?
     ORDER BY start_time ASC, id ASC`,
    [now, now, endMs, now, startMs],
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
  const db = await getDB();
  const sinceMs = Date.now() - (Math.max(1, days) * 24 * 60 * 60 * 1000);
  const nowMs = Date.now();
  const rows = await db.select<RawObservedWebDomainStatRow[]>(
    `SELECT segment.normalized_domain AS normalized_domain,
            MAX(COALESCE(segment.domain, segment.normalized_domain)) AS domain,
            SUM(COALESCE(segment.duration, MAX(0, MIN(?, segment.updated_at + 45000) - segment.start_time))) AS total_duration,
            MAX(segment.start_time) AS last_seen_ms,
            MAX(favicon_cache.favicon_url) AS favicon_url,
            MAX(segment.title) AS title
     FROM web_activity_segments AS segment
     LEFT JOIN web_favicon_cache AS favicon_cache
       ON favicon_cache.normalized_domain = segment.normalized_domain
     WHERE segment.start_time >= ?
     GROUP BY segment.normalized_domain
     ORDER BY last_seen_ms DESC, total_duration DESC
     LIMIT ?`,
    [nowMs, sinceMs, Math.max(1, limit)],
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

  const db = await getDB();
  for (let index = 0; index < normalizedDomains.length; index += WEB_FAVICON_QUERY_BATCH_SIZE) {
    const batch = normalizedDomains.slice(index, index + WEB_FAVICON_QUERY_BATCH_SIZE);
    const placeholders = batch.map(() => "?").join(", ");
    const rows = await db.select<RawWebFaviconRow[]>(
      `SELECT normalized_domain, favicon_url
       FROM web_favicon_cache
       WHERE normalized_domain IN (${placeholders})`,
      batch,
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
