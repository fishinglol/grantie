import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
const workspaceRoot = path.resolve(__dirname, "../..");

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // The `@granite/*` workspace packages are shipped as raw TS source.
  resolve: { preserveSymlinks: false },
  optimizeDeps: { exclude: ["@granite/core-notes", "@granite/core-cloud"] },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
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
    // 4. allow serving the workspace package source from outside this app dir
    fs: { allow: [workspaceRoot] },
  },
}));
