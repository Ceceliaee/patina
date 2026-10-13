import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { BUNDLE_OWNERSHIP_FILE, BUNDLE_SOURCE_OWNERS } from "./scripts/bundle-ownership.ts";

import { useDirectLucideIconModules } from "./scripts/vite-direct-lucide.ts";

const host = process.env.TAURI_DEV_HOST;
function recordBundleOwnership(): Plugin {
  return {
    name: "patina-bundle-ownership",
    generateBundle(_options, bundle) {
      const ownership = Object.fromEntries(BUNDLE_SOURCE_OWNERS.map(({ source }) => [
        source,
        Object.values(bundle).filter((output) => output.type === "chunk"
          && Object.keys(output.modules).some((id) => id.replaceAll("\\", "/").endsWith(`/${source}`)))
          .map((output) => output.fileName.replace(/^assets\//, "")),
      ]));
      this.emitFile({ type: "asset", fileName: BUNDLE_OWNERSHIP_FILE, source: JSON.stringify(ownership) });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [useDirectLucideIconModules(), tailwindcss(), react(), recordBundleOwnership()],
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
          const localeResourceMatch = normalizedId.match(
            /\/src\/shared\/i18n\/generated\/locales\/([^/?]+)\.ts(?:\?.*)?$/,
          );
          if (localeResourceMatch) {
            return `locale-${localeResourceMatch[1]}`;
          }
          if (!id.includes("node_modules")) {
            return undefined;
          }

          if (
            normalizedId.includes("/node_modules/lucide-react/dist/esm/")
            && (
              !normalizedId.includes("/node_modules/lucide-react/dist/esm/icons/")
              || normalizedId.endsWith("/node_modules/lucide-react/dist/esm/icons/rotate-ccw.mjs")
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
      ignored: ["**/src-tauri/**", "**/artifacts/**"],
    },
  },
});
