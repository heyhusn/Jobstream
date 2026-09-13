import { defineConfig } from "vite";
import { resolve } from "path";

// `root: 'src'` is load-bearing, not stylistic: without it, Vite keeps
// the "src/" prefix on every output path (dist/src/popup.html instead
// of dist/popup.html), which no longer matches manifest.json's
// "default_popup": "popup.html" — found while testing this build,
// see CLAUDE.md.
export default defineConfig({
  root: resolve(__dirname, "src"),
  publicDir: resolve(__dirname, "public"),
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "src/popup.html"),
        background: resolve(__dirname, "src/background.ts"),
        "content-extract": resolve(__dirname, "src/content-extract.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "[name].js",
        assetFileNames: "[name].[ext]"
      }
    }
  },
  envDir: resolve(__dirname, ".."),
});
