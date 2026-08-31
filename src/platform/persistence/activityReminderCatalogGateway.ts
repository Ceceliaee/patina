import {
  loadRecordedAppCatalogPage,
  loadSettingKeysByKeyPrefix,
  loadSettingRowsByKeyPrefix,
} from "./classificationPersistence.ts";
import { loadObservedWebDomainStats } from "./webActivityRepository.ts";
import {
  isAppCategory,
  isExtendedCategory,
  USER_ASSIGNABLE_CATEGORIES,
  type AppCategory,
} from "../../shared/classification/categoryTokens.ts";
import {
  resolveCanonicalExecutable,
  shouldTrackProcess,
} from "../../shared/classification/processNormalization.ts";
import type { AppOverride } from "../../shared/classification/processMapper.ts";
import type { WebDomainOverride } from "../../shared/types/webActivity.ts";

const APP_OVERRIDE_PREFIX = "__app_override::";
const WEB_OVERRIDE_PREFIX = "__web_domain_override::";
const CATEGORY_LABEL_PREFIX = "__category_label_override::";
const CATEGORY_COLOR_PREFIX = "__category_color_override::";
const CATEGORY_DEFINITION_PREFIX = "__custom_category::";
const DELETED_CATEGORY_PREFIX = "__deleted_category::";
const ACTIVITY_REMINDER_WEB_CANDIDATE_LOOKBACK_DAYS = 30;
const ACTIVITY_REMINDER_WEB_CANDIDATE_LIMIT = 120;

function parseObject<T extends object>(value: string): T | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as T : null;
  } catch {
    return null;
  }
}

function normalizeDomain(value: string): string {
  return value.trim().replace(/\.$/, "").toLocaleLowerCase();
}

interface ActivityReminderCatalogSnapshot {
  apps: Array<{ appName: string; exeName: string; lastSeenAt: number }>;
  categories: Array<{ categoryId: AppCategory; labelOverride: string | null; colorOverride: string | null }>;
  webDomains: Array<{
    normalizedDomain: string;
    label: string;
    faviconUrl: string | null;
    lastSeenAt: number;
  }>;
}

export async function loadActivityReminderAppCatalog(): Promise<ActivityReminderCatalogSnapshot["apps"]> {
  const appOverrideRows = await loadSettingRowsByKeyPrefix(APP_OVERRIDE_PREFIX);
  const appOverrides = new Map<string, AppOverride>();
  for (const row of appOverrideRows) {
    const exeName = resolveCanonicalExecutable(row.key.slice(APP_OVERRIDE_PREFIX.length));
    const override = parseObject<AppOverride>(row.value);
    if (exeName && override) appOverrides.set(exeName, override);
  }

  const apps = new Map<string, { appName: string; exeName: string; lastSeenAt: number }>();
  let cursor: { lastSeenMs: number; rawExeName: string } | null = null;
  for (let pageIndex = 0; pageIndex < 100; pageIndex += 1) {
    const page = await loadRecordedAppCatalogPage({ cursor, searchQuery: "", limit: 500 });
    for (const row of page.rows) {
      const exeName = resolveCanonicalExecutable(row.rawExeName);
      const override = appOverrides.get(exeName);
      if (
        !exeName
        || !shouldTrackProcess(row.rawExeName, { appName: row.appName })
        || override?.enabled === false
        || override?.track === false
      ) continue;
      const candidate = {
        appName: override?.displayName?.trim() || row.appName.trim() || exeName.replace(/\.exe$/i, ""),
        exeName,
        lastSeenAt: Math.max(0, row.lastSeenMs),
      };
      const previous = apps.get(exeName);
      if (!previous || candidate.lastSeenAt >= previous.lastSeenAt) apps.set(exeName, candidate);
    }
    if (!page.hasMore || !page.nextCursor) break;
    cursor = page.nextCursor;
  }

  return Array.from(apps.values()).sort((left, right) => right.lastSeenAt - left.lastSeenAt);
}

export async function loadActivityReminderCategoryCatalog(): Promise<ActivityReminderCatalogSnapshot["categories"]> {
  const [categoryLabelRows, categoryColorRows, categoryDefinitionRows, deletedCategoryRows] = await Promise.all([
    loadSettingRowsByKeyPrefix(CATEGORY_LABEL_PREFIX),
    loadSettingRowsByKeyPrefix(CATEGORY_COLOR_PREFIX),
    loadSettingKeysByKeyPrefix(CATEGORY_DEFINITION_PREFIX),
    loadSettingKeysByKeyPrefix(DELETED_CATEGORY_PREFIX),
  ]);
  const labelOverrides = new Map(categoryLabelRows.map((row) => [
    row.key.slice(CATEGORY_LABEL_PREFIX.length),
    row.value.trim() || null,
  ]));
  const colorOverrides = new Map(categoryColorRows.map((row) => [
    row.key.slice(CATEGORY_COLOR_PREFIX.length),
    row.value.trim() || null,
  ]));
  const deleted = new Set(deletedCategoryRows.map((row) => row.key.slice(DELETED_CATEGORY_PREFIX.length)));
  const categoryIds = new Set<string>(USER_ASSIGNABLE_CATEGORIES);
  for (const row of categoryDefinitionRows) {
    const categoryId = row.key.slice(CATEGORY_DEFINITION_PREFIX.length);
    if (isExtendedCategory(categoryId)) categoryIds.add(categoryId);
  }
  const categories = Array.from(categoryIds)
    .filter((categoryId): categoryId is AppCategory => isAppCategory(categoryId) && categoryId !== "system")
    .filter((categoryId) => !deleted.has(categoryId))
    .map((categoryId) => ({
      categoryId,
      labelOverride: labelOverrides.get(categoryId) ?? null,
      colorOverride: colorOverrides.get(categoryId) ?? null,
    }));

  return categories;
}

export async function loadActivityReminderWebCatalog(): Promise<ActivityReminderCatalogSnapshot["webDomains"]> {
  const [webOverrideRows, webRows] = await Promise.all([
    loadSettingRowsByKeyPrefix(WEB_OVERRIDE_PREFIX),
    loadObservedWebDomainStats(
      ACTIVITY_REMINDER_WEB_CANDIDATE_LOOKBACK_DAYS,
      ACTIVITY_REMINDER_WEB_CANDIDATE_LIMIT,
    ),
  ]);
  const webOverrides = new Map<string, WebDomainOverride>();
  for (const row of webOverrideRows) {
    const domain = normalizeDomain(row.key.slice(WEB_OVERRIDE_PREFIX.length));
    const override = parseObject<WebDomainOverride>(row.value);
    if (domain && override) webOverrides.set(domain, override);
  }
  const webDomains = webRows
    .map((row) => {
      const normalizedDomain = normalizeDomain(row.normalizedDomain);
      const override = webOverrides.get(normalizedDomain);
      if (!normalizedDomain || override?.enabled === false) return null;
      return {
        normalizedDomain,
        label: override?.displayName?.trim() || row.domain.trim() || normalizedDomain,
        faviconUrl: row.faviconUrl,
        lastSeenAt: Math.max(0, row.lastSeenMs),
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);

  return webDomains;
}
