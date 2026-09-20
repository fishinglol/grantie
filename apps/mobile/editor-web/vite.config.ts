import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Builds the editor page into one script + one stylesheet; scripts/build-editor.mjs then
// inlines both into `src/editorHtml.ts`, because a WebView has no server to load them from.
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  define: { "process.env.NODE_ENV": '"production"' },
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: { entry: path.resolve(__dirname, "main.tsx"), formats: ["iife"], name: "GraniteEditor", fileName: () => "editor.js" },
  },
});
