/**
 * End-to-end demo: read a real .md file from disk, parse it, insert an image,
 * write everything back. Run with:  npm run demo   (from packages/core-notes)
 *
 * This uses the Node FileSystem adapter. The desktop (Tauri) and mobile (React
 * Native) apps do the exact same calls with their own adapter.
 */
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodeFs } from "../adapters/nodeFs.ts";
import { NoteRepository } from "../src/index.ts";

// A 1x1 transparent PNG, so the demo has real image bytes to copy.
const PNG_1PX = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

const SAMPLE = `---
title: Trip planning
tags: [travel, 2026]
pinned: true
---

# Trip planning

Some notes about the trip. See [the map](https://maps.example.com).

## Packing list

- passport
- charger
`;

const dir = await mkdtemp(join(tmpdir(), "granite-demo-"));
const notePath = join(dir, "trip-planning.md");
await nodeFs.writeTextFile(notePath, SAMPLE);

const repo = new NoteRepository(nodeFs);

console.log("=== 1. Read + parse local markdown ===");
const note = await repo.load(notePath);
console.log({
  title: note.title,
  frontmatter: note.frontmatter,
  headings: note.headings,
  links: note.links,
  images: note.images,
  wordCount: note.wordCount,
});

console.log("\n=== 2. Insert an image ===");
const result = await repo.insertImage({
  notePath,
  image: { fileName: "Eiffel Tower.png", data: PNG_1PX },
  altText: "Eiffel Tower at night",
});
console.log("inserted snippet :", result.markdown);
console.log("image written to :", result.imagePath);
console.log("note now has     :", result.note.images.length, "image ref(s)");

console.log("\n=== 3. Files on disk ===");
for (const f of await readdir(dir, { recursive: true })) console.log("  ", f);

console.log("\n=== 4. Final note contents ===");
console.log(await readFile(notePath, "utf8"));
