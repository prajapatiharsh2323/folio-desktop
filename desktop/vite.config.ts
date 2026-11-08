import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8")
) as { version: string };

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  // Single source of truth for the About row and any future diagnostics.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 1420,
    strictPort: true,
    // Cargo writes DLLs under src-tauri/target while Vite watches the project;
    // on Windows the locked DLL makes the watcher crash with EBUSY.
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "es2022",
    minify: "esbuild",
    sourcemap: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
});