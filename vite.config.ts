import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig({
  plugins: [tailwindcss(), react()],
  optimizeDeps: {
    // Keep Vite dep-scan anchored to the app entry so Tauri build artifacts
    // under src-tauri/target are not treated as extra HTML entrypoints.
    entries: ["index.html"],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }

          if (
            id.includes("react-dom") ||
            id.includes("\\node_modules\\react\\") ||
            id.includes("/node_modules/react/")
          ) {
            return "react-vendor";
          }

          if (id.includes("recharts")) {
            return "charts";
          }

          if (id.includes("lucide-react")) {
            return "icons";
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
