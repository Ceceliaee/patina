export const BUNDLE_OWNERSHIP_FILE = ".vite/bundle-ownership.json";

export const BUNDLE_SOURCE_OWNERS = [
  { source: "src/platform/browser/browserStorageGateway.ts", chunk: "index", initial: true },
  { source: "src/platform/persistence/dataExportGateway.ts", chunk: "SettingsDataExportDialog", initial: false },
] as const;

export function validateBundleOwnership(report: unknown, assets: Set<string>, initial: Set<string>): string[] {
  if (!report || typeof report !== "object" || Array.isArray(report)) return ["invalid bundle ownership report"];
  const ownership = report as Record<string, unknown>;
  return BUNDLE_SOURCE_OWNERS.flatMap((owner) => {
    const files = ownership[owner.source];
    if (!Array.isArray(files) || files.length !== 1 || typeof files[0] !== "string") {
      return [`${owner.source} must have exactly one emitted chunk owner`];
    }
    const file = files[0];
    if (!assets.has(file) || !file.startsWith(`${owner.chunk}-`) || !file.endsWith(".js")
      || initial.has(file) !== owner.initial) {
      return [`${owner.source} must remain in the ${owner.initial ? "initial" : "lazy"} ${owner.chunk} chunk`];
    }
    return [];
  });
}
