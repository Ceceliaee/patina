import type { WebDomainOverride } from "../../../shared/types/webActivity.ts";
import type { WebActivityAggregateRange } from "../../../platform/persistence/webActivityAnalysisGateway.ts";

export interface DataWebActivitySnapshotDependencies {
  loadAggregateRange: (
    startMs: number,
    endMs: number,
    bucketBoundariesMs: number[],
    normalizedDomains: readonly string[] | null,
  ) => Promise<Pick<WebActivityAggregateRange, "records" | "domainCoverage">>;
  loadOverrides: () => Promise<Record<string, WebDomainOverride>>;
  loadFavicons: (domains: string[]) => Promise<Record<string, string>>;
}
