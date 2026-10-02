import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const TOP_LEVEL_DOC_LIMIT = 10;
const ENTRY_DOCUMENTS = [
  "AGENTS.md",
  "README.md",
  "README.zh-CN.md",
  "CONTRIBUTING.md",
  ".github/pull_request_template.md",
];

function visibleMarkdown(content: string) {
  let fence: string | undefined;
  let comment = false;
  let codeRun: string | undefined;
  const mask = (value: string) => value.replace(/[^\r]/g, " ");
  const lines = content.split("\n");
  return lines.map((line, lineIndex) => {
      const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
      if (fence) {
        if (marker && marker[0] === fence[0] && marker.length >= fence.length
          && line.trim() === marker) fence = undefined;
        return mask(line);
      }
      if (!comment && !codeRun && marker) {
        fence = marker;
        return mask(line);
      }
      let visible = "";
      let cursor = 0;
      while (cursor < line.length) {
        if (!comment && line[cursor] === "`") {
          const run = /^`+/.exec(line.slice(cursor))?.[0] ?? "`";
          if (codeRun === run) {
            codeRun = undefined;
          } else if (!codeRun) {
            const remaining = lines.slice(lineIndex).join("\n").slice(cursor + run.length);
            if ([...remaining.matchAll(/`+/g)].some((match) => match[0].length === run.length)) {
              codeRun = run;
            }
          }
          visible += run;
          cursor += run.length;
          continue;
        }
        if (codeRun || (!comment && !line.startsWith("<!--", cursor))) {
          visible += line[cursor];
          cursor += 1;
          continue;
        }
        const boundary = line.indexOf(comment ? "-->" : "<!--", cursor);
        if (boundary < 0) {
          visible += comment ? mask(line.slice(cursor)) : line.slice(cursor);
          break;
        }
        visible += comment ? mask(line.slice(cursor, boundary)) : line.slice(cursor, boundary);
        const markerLength = comment ? 3 : 4;
        visible += " ".repeat(markerLength);
        cursor = boundary + markerLength;
        comment = !comment;
      }
      return visible;
    }).join("\n");
}

function isPolicyDocument(relativePath: string) {
  return ENTRY_DOCUMENTS.includes(relativePath) || /^docs\/[^/]+\.md$/.test(relativePath);
}

export function selectDocumentPaths(paths: string[], archives = false) {
  return [...new Set(paths)].filter((file) => file.endsWith(".md") && (
    archives ? file.startsWith("docs/archive/") : (
      ENTRY_DOCUMENTS.includes(file) || file === "CHANGELOG.md"
      || (file.startsWith("docs/") && !file.startsWith("docs/archive/"))
      || /^tests\/fixtures\/.+\/README\.md$/.test(file)
    )
  )).sort();
}

function documentLinks(content: string) {
  const visible = visibleMarkdown(content).replace(/(`+)([^]*?)\1/g,
    (value) => value.replace(/[^\r\n]/g, " "));
  const links: { target: string; offset: number }[] = [];
  for (const match of visible.matchAll(/!?\[[^\]]*]\(([^)]+)\)/g)) {
    links.push({ target: match[1] ?? "", offset: match.index });
  }
  for (const tag of visible.matchAll(/<[a-z][^>]*>/gi)) {
    for (const attribute of tag[0].matchAll(/\b(href|src|srcset)\s*=\s*["']([^"']+)["']/gi)) {
      const raw = attribute[2] ?? "";
      const targets = attribute[1]?.toLowerCase() === "srcset"
        ? raw.startsWith("data:") ? [raw] : raw.split(",").map((item) => item.trim().split(/\s+/)[0] ?? "")
        : [raw];
      for (const target of targets) links.push({ target, offset: tag.index + attribute.index });
    }
  }
  return links;
}

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
  const trimmed = rawTarget.trim();
  const withoutTitle = trimmed.startsWith("<")
    ? trimmed.slice(1, trimmed.indexOf(">"))
    : trimmed.split(/\s+(?=["'])/, 1)[0] ?? "";
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
  content = visibleMarkdown(content);
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
    const policyDocument = isPolicyDocument(document.relativePath);
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
      const match = policyDocument ? forbidden.pattern.exec(document.content) : null;
      if (match?.index !== undefined) {
        errors.push(
          `${document.relativePath}:${lineNumber(document.content, match.index)} binds repository policy to ${forbidden.label}`,
        );
      }
    }

    for (const link of documentLinks(document.content)) {
      const rawTarget = link.target;
      if (policyDocument && /\.agents[\\/]skills/.test(rawTarget)) {
        errors.push(`${document.relativePath}:${lineNumber(document.content, link.offset)} links ignored local Agent Skills as repository state`);
      }
      const { targetPath, fragment } = parseLinkTarget(rawTarget);
      if (isExternalTarget(targetPath)) continue;

      let decodedTarget = targetPath;
      let decodedFragment = fragment;
      try {
        decodedTarget = decodeURIComponent(targetPath);
        decodedFragment = decodeURIComponent(fragment).toLowerCase();
      } catch {
        errors.push(
          `${document.relativePath}:${lineNumber(document.content, link.offset)} has invalid URL encoding in ${rawTarget}`,
        );
        continue;
      }

      const absoluteTarget = decodedTarget
        ? path.resolve(root, path.dirname(document.relativePath), decodedTarget)
        : path.resolve(root, document.relativePath);
      const relativeTarget = path.relative(root, absoluteTarget);
      if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
        errors.push(
          `${document.relativePath}:${lineNumber(document.content, link.offset)} links outside the repository: ${rawTarget}`,
        );
      } else if (!targetExists(absoluteTarget)) {
        errors.push(
          `${document.relativePath}:${lineNumber(document.content, link.offset)} links missing target: ${rawTarget}`,
        );
      } else if (decodedFragment) {
        const linkedContent = documentContent.get(absoluteTarget) ?? targetContent(absoluteTarget);
        if (linkedContent !== null && !markdownAnchors(linkedContent).has(decodedFragment)) {
          errors.push(
            `${document.relativePath}:${lineNumber(document.content, link.offset)} links missing fragment: #${fragment}`,
          );
        }
      }
    }
  }

  return errors;
}

function readRepositoryDocuments() {
  const inventory = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "*.md"],
    { cwd: ROOT, encoding: "utf8" }).split("\0").filter((file) => file && existsSync(path.join(ROOT, file)));
  const topLevelDocPaths = inventory.filter((file) => /^docs\/[^/]+\.md$/.test(file));
  const documentPaths = selectDocumentPaths([...inventory, ...ENTRY_DOCUMENTS], process.argv.includes("--archives"));

  return {
    topLevelDocPaths,
    documents: documentPaths.map((relativePath) => ({
      relativePath,
      content: new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path.join(ROOT, relativePath))),
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
  const nestedPaths = ["README.zh-CN.md", "docs/examples/worker/README.md", "docs/working/new-plan.md"];
  assert.deepEqual(selectDocumentPaths([...nestedPaths, "docs/archive/old.md", ".agents/skills/local/SKILL.md"]), nestedPaths);
  assert.deepEqual(selectDocumentPaths(["docs/archive/old.md", ...nestedPaths], true), ["docs/archive/old.md"]);
  for (const relativePath of nestedPaths) {
    const errors = collectDocGovernanceErrors({ root: fixtureRoot,
      documents: [{ relativePath, content: '[broken](missing.md)\n<img src="missing.png">' }],
      topLevelDocPaths: [], targetExists: () => false });
    assert.equal(errors.filter((error) => error.includes("missing target")).length, 2);
  }
  const syntax = [
    "# 中文 标题", "# Duplicate", "# Duplicate", '<a id="explicit"></a>',
    "[中文](#中文-标题) [repeat](#duplicate-1) [html](#explicit)",
    '<img src="image%20one.png"><source srcset="one.png 1x, two.png 2x">',
    '[titled](<image%20one.png> "caption")',
    "```md", "# Duplicate", "[example](missing.md)", "```",
    "~~~", '<img src="missing.png">', "~~~",
    '<!-- [comment](missing.md) -->', '`[inline](missing.md)`',
    "[external](https://example.com/path#fragment)",
  ].join("\n");
  const syntaxErrors = collectDocGovernanceErrors({ root: fixtureRoot,
    documents: [{ relativePath: "README.md", content: syntax }], topLevelDocPaths: [],
    targetExists: (target) => ["README.md", "image one.png", "one.png", "two.png"].includes(path.basename(target)) });
  assert.deepEqual(syntaxErrors, []);
  const falseAnchorErrors = collectDocGovernanceErrors({ root: fixtureRoot,
    documents: [{ relativePath: "README.md", content: "```md\n# Example\n```\n[bad](#example)" }],
    topLevelDocPaths: [], targetExists: () => true });
  assert.ok(falseAnchorErrors.some((error) => error.includes("missing fragment")));
  const fenceCommentErrors = collectDocGovernanceErrors({ root: fixtureRoot,
    documents: [{ relativePath: "README.md", content:
      "```html\n<!--\n```\n[bad](missing.md)\n<!-- normal comment -->" }],
    topLevelDocPaths: [], targetExists: () => false });
  assert.equal(fenceCommentErrors.length, 1);
  assert.ok(fenceCommentErrors[0]?.includes("README.md:4 links missing target: missing.md"));
  const inlineCommentErrors = collectDocGovernanceErrors({ root: fixtureRoot,
    documents: [{ relativePath: "README.md", content:
      "Use `<!--` to begin a comment.\n[bad](missing.md)" }],
    topLevelDocPaths: [], targetExists: () => false });
  assert.equal(inlineCommentErrors.length, 1);
  assert.ok(inlineCommentErrors[0]?.includes("README.md:2 links missing target: missing.md"));
  const multilineCommentErrors = collectDocGovernanceErrors({ root: fixtureRoot,
    documents: [{ relativePath: "README.md", content:
      "Use `<!--\nexample` to begin a comment.\n[bad](missing.md)" }],
    topLevelDocPaths: [], targetExists: () => false });
  assert.equal(multilineCommentErrors.length, 1);
  assert.ok(multilineCommentErrors[0]?.includes("README.md:3 links missing target: missing.md"));
  assert.deepEqual(collectDocGovernanceErrors({ root: fixtureRoot,
    documents: [{ relativePath: "docs/archive/old.md", content: "Used the browser control plugin." }],
    topLevelDocPaths: [] }), []);
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
    `Documentation governance passed (${input.documents.length} scanned documents; ${input.topLevelDocPaths.length}/${TOP_LEVEL_DOC_LIMIT} top-level docs)`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
