import assert from "node:assert/strict";
import { groupWebCandidates, refreshKnownWebDomains, resolveWebOwner, siteRuleFromOverride } from "../src/shared/classification/webLinks.ts";
import type { WebActivitySegment, WebDomainOverride } from "../src/shared/types/webActivity.ts";
import { buildClassificationDraftChangePlan, cloneClassificationDraftState, hasClassificationDraftChanges } from "../src/features/classification/services/classificationDraftState.ts";
import { buildCommitDraftChangePlanSettingMutations } from "../src/features/classification/services/classificationStore.ts";
import { deleteCategoryFromDraftState, updateWebDomainOverrideInDraftState } from "../src/features/classification/hooks/appMappingStateHelpers.ts";
import { buildWebDomainDistribution } from "../src/features/history/services/historyWebActivityViewModel.ts";
import { webLinksOverrides } from "../src/platform/persistence/webLinksGateway.ts";

const deletedPreferences = { displayName: "Deleted site", category: "development" as const, captureTitle: false };
const afterDeletion = webLinksOverrides({ domains: ["old.example.com"], rules: {}, overrides: { "example.com": deletedPreferences } });
assert.deepEqual(groupWebCandidates([], afterDeletion).map(card => card.normalizedDomain), ["old.example.com"], "persisted preferences are not evidence of history; older recorded domains remain manageable");
const refreshedDeletion = refreshKnownWebDomains({ "example.com": { ...deletedPreferences, knownDomain: true } }, {});
assert.deepEqual(groupWebCandidates([], refreshedDeletion), [], "a fresh snapshot clears stale existence even when an unsaved preference remains");
assert.equal(refreshedDeletion["example.com"].displayName, deletedPreferences.displayName);
const emptyLink = { "site:example.com": { siteRule: { members: ["member.example.com"] } } };
assert.deepEqual(groupWebCandidates([], emptyLink)[0].memberCandidates?.map(card => card.normalizedDomain), ["example.com", "member.example.com"], "history deletion preserves both ends of a manageable relationship");
assert.deepEqual(groupWebCandidates([], { "excluded.example.com": { enabled: false } }).map(card => card.normalizedDomain), ["excluded.example.com"]);

const raw: Record<string, WebDomainOverride> = {
  "www.example.com": { knownDomain: true, displayName: "Original", category: "development" },
  "mail.example.com": { knownDomain: true, captureTitle: false },
  "a.mail.example.com": { knownDomain: true },
  "excluded.example.com": { knownDomain: true, enabled: false },
  "other.com": { knownDomain: true },
};
const key = "site:www.example.com";
const grouped: Record<string, WebDomainOverride> = { ...raw, [key]: {
  displayName: "Website", category: "development",
  siteRule: { members: ["a.mail.example.com", "excluded.example.com"] },
} };
assert.equal(resolveWebOwner("mail.example.com", grouped), "mail.example.com");
assert.equal(resolveWebOwner("a.mail.example.com", grouped), key);
assert.equal(resolveWebOwner("future.example.com", grouped), "future.example.com");
assert.equal(resolveWebOwner(key, grouped), key);
const crossSite = { ...grouped, [key]: { siteRule: { members: ["other.com"] } } };
assert.equal(resolveWebOwner("other.com", crossSite), key);
const candidates = Object.keys(raw).map((domain, i) => ({ normalizedDomain: domain, domain, totalDuration: (i + 1) * 1000, lastSeenMs: i, faviconUrl: null, title: null }));
const cards = groupWebCandidates(candidates, grouped);
assert.equal(cards.length, 3);
assert.equal(cards.find(card => card.normalizedDomain === key)?.totalDuration, 4000);
assert.equal(candidates[0].normalizedDomain, "www.example.com");
assert.equal(cards.find(card => card.normalizedDomain === key)?.faviconUrl, null);
const primaryIcon = "https://www.example.com/favicon.ico";
const memberIcon = "https://a.mail.example.com/favicon.ico";
const withIcons = candidates.map(candidate => ({ ...candidate, faviconUrl: candidate.normalizedDomain === "www.example.com" ? primaryIcon : memberIcon }));
assert.equal(groupWebCandidates(withIcons, grouped).find(card => card.normalizedDomain === key)?.faviconUrl, primaryIcon);
withIcons[0].faviconUrl = " ";
assert.equal(groupWebCandidates(withIcons, grouped).find(card => card.normalizedDomain === key)?.faviconUrl, memberIcon);

const saved = { overrides: {}, webDomainOverrides: raw, categoryColorOverrides: {}, categoryLabelOverrides: {}, persistedCategoryIds: [], deletedCategories: [] };
const draft = { ...cloneClassificationDraftState(saved), webDomainOverrides: grouped };
assert.equal(hasClassificationDraftChanges(saved, draft), true);
const copy = cloneClassificationDraftState(draft);
copy.webDomainOverrides[key].siteRule!.members.push("other.com");
assert.deepEqual(grouped[key].siteRule!.members, ["a.mail.example.com", "excluded.example.com"]);
const mutations = buildCommitDraftChangePlanSettingMutations(buildClassificationDraftChangePlan(saved, draft));
assert.equal(mutations.length, 1);
assert.equal(mutations[0].key, "__web_site::www.example.com");
assert.deepEqual(JSON.parse(mutations[0].value!), { previous: null, next: { members: ["a.mail.example.com", "excluded.example.com"], displayName: "Website", category: "development" } });
assert.equal(updateWebDomainOverrideInDraftState(draft, key, null).webDomainOverrides[key], undefined);
const edited = updateWebDomainOverrideInDraftState(draft, key, { color: "#123456" });
assert.deepEqual(siteRuleFromOverride(edited.webDomainOverrides[key])?.members, grouped[key].siteRule!.members);
assert.equal(edited.webDomainOverrides["mail.example.com"].captureTitle, false);
assert.equal(deleteCategoryFromDraftState(draft, "development").webDomainOverrides[key].category, undefined);

const segments: WebActivitySegment[] = candidates.map((candidate, i) => ({
  id: i + 1, browserClientId: "fixture", browserKind: "chrome", browserExeName: "chrome.exe",
  normalizedDomain: candidate.normalizedDomain, domain: candidate.domain, url: "https://" + candidate.domain + "/page",
  title: null, faviconUrl: null, startTime: 1000 + i * 10000, endTime: 6000 + i * 10000, duration: 5000,
}));
const before = buildWebDomainDistribution(segments, { startMs: 0, endMs: 60000 }, 60000, raw);
const after = buildWebDomainDistribution(segments, { startMs: 0, endMs: 60000 }, 60000, grouped);
assert.equal(after.reduce((sum, row) => sum + row.duration, 0), before.reduce((sum, row) => sum + row.duration, 0));
assert.equal(after.find(row => row.key === key)?.duration, 10000);
assert.equal(after.find(row => row.key === key)?.label, "Website");
const unlinked = updateWebDomainOverrideInDraftState(draft, key, null).webDomainOverrides;
assert.deepEqual(buildWebDomainDistribution(segments, { startMs: 0, endMs: 60000 }, 60000, unlinked), before);
const refreshed = refreshKnownWebDomains(grouped, { "www.example.com": raw["www.example.com"], [key]: grouped[key] });
assert.deepEqual(refreshed[key].siteRule, grouped[key].siteRule);
assert.equal(refreshed["excluded.example.com"].enabled, false);
const largeCandidates = Array.from({ length: 10000 }, (_, i) => ({ ...candidates[0], normalizedDomain: "d" + i + ".example.com", domain: "d" + i + ".example.com", totalDuration: 1000 }));
const largeOverrides = { [key]: { siteRule: { members: largeCandidates.map(candidate => candidate.normalizedDomain) } } };
const started = performance.now();
const largeCards = groupWebCandidates(largeCandidates, largeOverrides);
assert.equal(largeCards.length, 1);
assert.equal(largeCards[0].totalDuration, 10000000);
console.log("Manual website links: ownership, draft isolation, persistence, icons and conservation passed; 10000 domains in " + (performance.now() - started) + " ms");
