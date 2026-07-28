import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;
const LUCIDE_ICON_MODULE_ALIASES: Record<string, string> = {
  Fingerprint: "fingerprint-pattern",
};

function toKebabCaseIconName(name: string) {
  return LUCIDE_ICON_MODULE_ALIASES[name] ?? name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .replace(/([A-Za-z])([0-9])/g, "$1-$2")
    .replace(/([0-9])([A-Za-z])/g, "$1-$2")
    .toLowerCase();
}

function useDirectLucideIconModules() {
  const lucideImportPattern =
    /import\s*\{\s*([^}]+)\s*\}\s*from\s*["']lucide-react["'];/g;

  return {
    name: "patina-direct-lucide-icon-modules",
    enforce: "pre" as const,
    transform(code: string, id: string) {
      if (!id.includes("/src/") && !id.includes("\\src\\")) return null;
      if (!code.includes("lucide-react")) return null;

      const transformed = code.replace(lucideImportPattern, (statement, bindings: string) => {
        const names = bindings.split(",").map((name) => name.trim()).filter(Boolean);
        if (names.length === 0 || names.some((name) => name.startsWith("type "))) {
          return statement;
        }
        return names.map((name) => (
          `import ${name} from "lucide-react/dist/esm/icons/${toKebabCaseIconName(name)}.js";`
        )).join("\n");
      });
      return transformed === code ? null : { code: transformed, map: null };
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [useDirectLucideIconModules(), tailwindcss(), react()],
  optimizeDeps: {
    // Keep Vite dep-scan anchored to the app entry so Tauri build artifacts
    // under src-tauri/target are not treated as extra HTML entrypoints.
    entries: ["index.html"],
    // Source imports are rewritten to direct icon modules before serving. Do
    // not simultaneously prebundle the package root into a competing graph.
    exclude: ["lucide-react"],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replaceAll("\\", "/");
          if (!id.includes("node_modules")) {
            return undefined;
          }

          if (
            normalizedId.includes("/node_modules/lucide-react/dist/esm/")
            && (
              !normalizedId.includes("/node_modules/lucide-react/dist/esm/icons/")
              || normalizedId.endsWith("/node_modules/lucide-react/dist/esm/icons/rotate-ccw.js")
            )
          ) {
            return "icons";
          }

          if (
            id.includes("react-dom") ||
            id.includes("\\node_modules\\react\\") ||
            id.includes("/node_modules/react/")
          ) {
            return "react-vendor";
          }

          if (id.includes("framer-motion")) {
            return "motion";
          }

          if (id.includes("@tauri-apps")) {
            return "tauri";
          }

          return undefined;
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
});
