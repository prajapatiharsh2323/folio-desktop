import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

export default defineConfig({
  plugins: [
    react(),
    // pdf.js data assets (PDF plan §4): CMaps for CJK/Indic CID fonts,
    // standard font data for non-embedded base-14 fonts, and WASM for
    // JPEG 2000 / JBIG2 images. Served same-origin from dist/pdfjs/ under
    // connect-src 'self'; no network hosts are introduced.
    viteStaticCopy({
      targets: [
        { src: "node_modules/pdfjs-dist/cmaps", dest: "pdfjs" },
        { src: "node_modules/pdfjs-dist/standard_fonts", dest: "pdfjs" },
        { src: "node_modules/pdfjs-dist/wasm", dest: "pdfjs" },
      ],
    }),
  ],
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
  // pdf.js enters the bundle only through src/pdf/pdfjsAdapter.ts's dynamic
  // import, so Rollup already code-splits it into a lazy chunk; nothing extra
  // is pinned via manualChunks (the existing chunk-size warning covers it).
  test: {
    environment: "jsdom",
    globals: true,
  },
});
