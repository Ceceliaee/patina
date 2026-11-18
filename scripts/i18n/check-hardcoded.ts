import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { loadLocaleMessages, REPO_ROOT } from "./core.ts";

type Finding = { file: string; value: string; kind: string };

async function scanRustNativeSurfaces(): Promise<Finding[]> {
  const sourceMessages = await loadLocaleMessages("zh-CN");
  const localizedValues = Object.entries(sourceMessages)
    .filter(([key, value]) => key.startsWith("native.") && typeof value === "string")
    .map(([, value]) => value as string).filter((value) => value.length >= 2);
  const files = [
    ...readdirSync(join(REPO_ROOT, "desktop/patina/src"), { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith(".rs"))
      .map(entry => relative(REPO_ROOT, join(entry.parentPath, entry.name))),
    "desktop/recorder/src/data/export/common.rs",
    "desktop/recorder/src/data/export/markdown_exporter.rs",
  ];
  const findings: Finding[] = [];
  for (const file of files) {
    const source = readFileSync(join(REPO_ROOT, file), "utf8").split("#[cfg(test)]")[0];
    const literals = new Set([...source.matchAll(/"(?:\\.|[^"\\])*"/g)].map((match) => match[0].slice(1, -1)));
    for (const value of localizedValues) {
      if (literals.has(value)) findings.push({ file, value, kind: "rust-native-copy" });
    }
  }
  return findings;
}

const findings = await scanRustNativeSurfaces();
if (findings.length) {
  throw new Error(findings.map(item => item.file + ": " + item.value).join("\n"));
}
