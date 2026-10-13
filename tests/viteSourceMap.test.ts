import assert from "node:assert/strict";
import { SourceMap } from "node:module";
import { transformLucideImports } from "../scripts/vite-direct-lucide.ts";

for (const imports of [
  'import { Camera } from "lucide-react";',
  'import { Camera, Fingerprint as Identity } from "lucide-react";',
  'import {\n Camera,\n Fingerprint as Identity,\n} from "lucide-react";',
]) {
  const source = `const before = 1;\n${imports}\nexport const after = before + 1;\n`;
  const result = transformLucideImports(source, "/repo/src/fixture.tsx");
  assert.ok(result);
  assert.match(result.code, /icons\/camera.mjs/);
  if (imports.includes("Identity")) assert.match(result.code, /import Identity from "lucide-react\/dist\/esm\/icons\/fingerprint-pattern.mjs"/);
  const map = new SourceMap(JSON.parse(result.map.toString()));
  for (const token of ["const before", "export const after"]) {
    const outputLine = result.code.split("\n").findIndex(line => line.startsWith(token));
    const originalLine = source.split("\n").findIndex(line => line.startsWith(token));
    const entry = map.findEntry(outputLine, 0);
    assert.ok("originalLine" in entry);
    assert.equal(entry.originalLine, originalLine);
    assert.equal(entry.originalColumn, 0);
  }
  assert.deepEqual(result.map.sourcesContent, [source]);
}
assert.equal(transformLucideImports('const x = 1;', "/repo/src/plain.ts"), null);
assert.equal(transformLucideImports('import { type IconNode } from "lucide-react";', "/repo/src/types.ts"), null);
assert.equal(transformLucideImports('import { Camera } from "lucide-react";', "/repo/vendor/external.ts"), null);
console.log("PASS direct icon imports preserve source positions, aliases and untouched modules");
