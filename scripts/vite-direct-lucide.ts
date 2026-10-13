import MagicString from "magic-string";
import type { Plugin } from "vite";

const ALIASES: Record<string, string> = { Fingerprint: "fingerprint-pattern" };
function iconModule(name: string) {
  return ALIASES[name] ?? name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .replace(/([A-Za-z])([0-9])/g, "$1-$2")
    .replace(/([0-9])([A-Za-z])/g, "$1-$2")
    .toLowerCase();
}

export function transformLucideImports(code: string, id: string) {
  if (!id.replaceAll("\\", "/").includes("/src/")) return null;
  const output = new MagicString(code);
  const pattern = /import\s*\{\s*([^}]+)\s*\}\s*from\s*["']lucide-react["'];/g;
  for (const match of code.matchAll(pattern)) {
    const names = match[1].split(",").map(name => name.trim()).filter(Boolean);
    const bindings = names.map(name => /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(name));
    // Type imports and unsupported syntax stay with Vite's normal transform.
    if (!bindings.length || bindings.some(binding => !binding)) continue;
    const imports = bindings.map(binding => {
      const [, imported, local = imported] = binding!;
      return `import ${local} from "lucide-react/dist/esm/icons/${iconModule(imported)}.mjs";`;
    });
    output.overwrite(match.index, match.index + match[0].length, imports.join("\n"));
  }
  if (!output.hasChanged()) return null;
  return { code: output.toString(), map: output.generateMap({ source: id, includeContent: true, hires: true }) };
}

export function useDirectLucideIconModules(): Plugin {
  return { name: "patina-direct-lucide-icon-modules", enforce: "pre", transform: transformLucideImports };
}
