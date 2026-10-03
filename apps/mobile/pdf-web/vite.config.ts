import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  root: __dirname,
  define: { "process.env.NODE_ENV": '"production"' },
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
    cssCodeSplit: false,
    target: "es2020",
    lib: {
      entry: path.resolve(__dirname, "main.ts"),
      formats: ["iife"],
      name: "GranitePdfReader",
      fileName: () => "reader.js",
    },
  },
});
