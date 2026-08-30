import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const TOP_LEVEL_DOC_LIMIT = 10;
const ENTRY_DOCUMENTS = [
  "AGENTS.md",
  "README.md",
  "CONTRIBUTING.md",
  ".github/pull_request_template.md",
];

interface DocumentInput {
  relativePath: string;
  content: string;
}

interface GovernanceInput {
  root: string;
  documents: DocumentInput[];
  topLevelDocPaths: string[];
  targetExists?: (absolutePath: string) => boolean;
  targetContent?: (absolutePath: string) => string | null;
}

function lineNumber(content: string, offset: number) {
  return content.slice(0, offset).split(/\r?\n/).length;
}

function parseLinkTarget(rawTarget: string) {
  const unwrapped = rawTarget.trim().replace(/^<|>$/g, "");
  const withoutTitle = unwrapped.split(/\s+(?=["'])/, 1)[0] ?? "";
  const fragmentIndex = withoutTitle.indexOf("#");
  const pathAndQuery = fragmentIndex >= 0 ? withoutTitle.slice(0, fragmentIndex) : withoutTitle;
  const fragment = fragmentIndex >= 0 ? withoutTitle.slice(fragmentIndex + 1) : "";
  return {
    targetPath: pathAndQuery.split("?", 1)[0] ?? "",
    fragment,
  };
}

function isExternalTarget(target: string) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target);
}

function markdownAnchors(content: string) {
  const anchors = new Set<string>();
  const slugCounts = new Map<string, number>();

  for (const match of content.matchAll(/<a\s+[^>]*id=["']([^"']+)["'][^>]*>/gi)) {
    anchors.add((match[1] ?? "").toLowerCase());
  }

  for (const match of content.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const baseSlug = (match[1] ?? "")
      .replace(/<[^>]+>/g, "")
      .replace(/`/g, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M} _-]/gu, "")
      .trim()
      .replace(/\s+/g, "-");
    if (!baseSlug) continue;
    const seen = slugCounts.get(baseSlug) ?? 0;
    anchors.add(seen === 0 ? baseSlug : `${baseSlug}-${seen}`);
    slugCounts.set(baseSlug, seen + 1);
  }

  return anchors;
}

export function collectDocGovernanceErrors({
  root,
  documents,
  topLevelDocPaths,
  targetExists = existsSync,
  targetContent = (absolutePath) => {
    try {
      return readFileSync(absolutePath, "utf8");
    } catch {
      return null;
    }
  },
}: GovernanceInput) {
  const errors: string[] = [];
  const documentContent = new Map(
    documents.map((document) => [
      path.resolve(root, document.relativePath),
      document.content,
    ]),
  );

  if (topLevelDocPaths.length > TOP_LEVEL_DOC_LIMIT) {
    errors.push(
      `top-level docs contain ${topLevelDocPaths.length} Markdown files; limit is ${TOP_LEVEL_DOC_LIMIT}`,
    );
  }

  for (const document of documents) {
    if (
      document.relativePath === "docs/versioning-and-release-policy.md"
      && /(?:当前(?:代码)?版本(?:为|：|:)|代码版本为|current(?:\s+code)?\s+version(?:\s+is|:))\s*`?v?\d+\.\d+\.\d+/i.test(document.content)
    ) {
      errors.push(`${document.relativePath}: current code version belongs to version files, not policy prose`);
    }

    for (const forbidden of [
      { pattern: /浏览器控制插件/, label: "浏览器控制插件" },
      { pattern: /GitHub 连接器插件/i, label: "GitHub 连接器插件" },
      { pattern: /browser control plugin/i, label: "browser control plugin" },
      { pattern: /GitHub connector plugin/i, label: "GitHub connector plugin" },
    ]) {
      const match = forbidden.pattern.exec(document.content);
      if (match?.index !== undefined) {
        errors.push(
          `${document.relativePath}:${lineNumber(document.content, match.index)} binds repository policy to ${forbidden.label}`,
        );
      }
    }

    const ignoredSkillLink = /!?\[[^\]]*]\(([^)]*\.agents[\\/]skills[^)]*)\)/g;
    for (const match of document.content.matchAll(ignoredSkillLink)) {
      errors.push(
        `${document.relativePath}:${lineNumber(document.content, match.index ?? 0)} links ignored local Agent Skills as repository state`,
      );
    }

    const markdownLink = /!?\[[^\]]*]\(([^)]+)\)/g;
    for (const match of document.content.matchAll(markdownLink)) {
      const rawTarget = match[1] ?? "";
      const { targetPath, fragment } = parseLinkTarget(rawTarget);
      if (isExternalTarget(targetPath)) continue;

      let decodedTarget = targetPath;
      let decodedFragment = fragment;
      try {
        decodedTarget = decodeURIComponent(targetPath);
        decodedFragment = decodeURIComponent(fragment).toLowerCase();
      } catch {
        errors.push(
          `${document.relativePath}:${lineNumber(document.content, match.index ?? 0)} has invalid URL encoding in ${rawTarget}`,
        );
        continue;
      }

      const absoluteTarget = decodedTarget
        ? path.resolve(root, path.dirname(document.relativePath), decodedTarget)
        : path.resolve(root, document.relativePath);
      const relativeTarget = path.relative(root, absoluteTarget);
      if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
        errors.push(
          `${document.relativePath}:${lineNumber(document.content, match.index ?? 0)} links outside the repository: ${rawTarget}`,
        );
      } else if (!targetExists(absoluteTarget)) {
        errors.push(
          `${document.relativePath}:${lineNumber(document.content, match.index ?? 0)} links missing target: ${rawTarget}`,
        );
      } else if (decodedFragment) {
        const linkedContent = documentContent.get(absoluteTarget) ?? targetContent(absoluteTarget);
        if (linkedContent !== null && !markdownAnchors(linkedContent).has(decodedFragment)) {
          errors.push(
            `${document.relativePath}:${lineNumber(document.content, match.index ?? 0)} links missing fragment: #${fragment}`,
          );
        }
      }
    }
  }

  return errors;
}

function readRepositoryDocuments() {
  const topLevelDocPaths = readdirSync(path.join(ROOT, "docs"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.posix.join("docs", entry.name))
    .sort();
  const documentPaths = [...ENTRY_DOCUMENTS, ...topLevelDocPaths];

  return {
    topLevelDocPaths,
    documents: documentPaths.map((relativePath) => ({
      relativePath,
      content: readFileSync(path.join(ROOT, relativePath), "utf8"),
    })),
  };
}

function runSelfTest() {
  const fixtureRoot = path.resolve("C:/patina-doc-governance-fixture");
  const knownTargets = new Set([
    path.resolve(fixtureRoot, "README.md"),
    path.resolve(fixtureRoot, "docs", "owner.md"),
  ]);
  const validDocuments = [
    {
      relativePath: "README.md",
      content: "Read [the owner](docs/owner.md#contract).",
    },
    {
      relativePath: "docs/owner.md",
      content: "# Contract\n\nExternal [reference](https://example.com).",
    },
  ];

  assert.deepEqual(
    collectDocGovernanceErrors({
      root: fixtureRoot,
      documents: validDocuments,
      topLevelDocPaths: ["docs/owner.md"],
      targetExists: (target) => knownTargets.has(path.resolve(target)),
      targetContent: (target) => validDocuments.find(
        (document) => path.resolve(fixtureRoot, document.relativePath) === path.resolve(target),
      )?.content ?? null,
    }),
    [],
  );

  const invalidErrors = collectDocGovernanceErrors({
    root: fixtureRoot,
    documents: [
      {
        relativePath: "docs/versioning-and-release-policy.md",
        content: [
          "Current code version: 9.9.9",
          "Must use the browser control plugin.",
          "[local](../.agents/skills/example/SKILL.md)",
          "[missing](./missing.md)",
          "[bad fragment](./anchor.md#absent)",
        ].join("\n"),
      },
      {
        relativePath: "docs/anchor.md",
        content: "# Present",
      },
    ],
    topLevelDocPaths: Array.from({ length: TOP_LEVEL_DOC_LIMIT + 1 }, (_, index) => `docs/${index}.md`),
    targetExists: (target) => [
      path.resolve(fixtureRoot, "docs/versioning-and-release-policy.md"),
      path.resolve(fixtureRoot, "docs/anchor.md"),
    ].includes(path.resolve(target)),
    targetContent: (target) => path.resolve(target) === path.resolve(fixtureRoot, "docs/anchor.md")
      ? "# Present"
      : null,
  });

  assert.ok(invalidErrors.some((error) => error.includes("limit is 10")));
  assert.ok(invalidErrors.some((error) => error.includes("current code version")));
  assert.ok(invalidErrors.some((error) => error.includes("browser control plugin")));
  assert.ok(invalidErrors.some((error) => error.includes("ignored local Agent Skills")));
  assert.ok(invalidErrors.some((error) => error.includes("missing target")));
  assert.ok(invalidErrors.some((error) => error.includes("missing fragment")));
  console.log("Passed documentation governance self-test");
}

function main() {
  if (process.argv.includes("--self-test")) {
    runSelfTest();
    return;
  }

  const input = readRepositoryDocuments();
  const errors = collectDocGovernanceErrors({ root: ROOT, ...input });
  if (errors.length > 0) {
    console.error(`Documentation governance failed:\n- ${errors.join("\n- ")}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `Documentation governance passed (${input.topLevelDocPaths.length}/${TOP_LEVEL_DOC_LIMIT} top-level docs)`,
  );
}

main();
