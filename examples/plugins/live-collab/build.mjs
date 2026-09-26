// Bundles src/main.ts (with Yjs and the websocket client) into the single main.js file a Granite plugin is. Run: npm run build
import { build } from "esbuild";
import { statSync } from "node:fs";

await build({
  entryPoints: ["src/main.ts"],
  outfile: "main.js",
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  minify: true,
  legalComments: "none",
  define: { "process.env.NODE_ENV": '"production"' },
});
console.log(`main.js written (${Math.round(statSync("main.js").size / 1024)} KB)`);
