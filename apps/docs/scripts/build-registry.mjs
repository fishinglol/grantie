// Reads examples/plugins/* (the same folders the apps' Store is built from) and writes what the public plugin pages
// and the install counter need: api/_registry.json and api/_ids.ts, plus each plugin's screenshots under public/plugin-shots/<id>/.
// A plugin with a bad manifest or fewer than MIN_SCREENSHOTS pictures is left out, exactly as in the apps' Store.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PERMISSION_LABELS, parseManifest } from "../../../packages/plugins/src/manifest.ts";

const MIN_SCREENSHOTS = 3;
const docs = join(dirname(fileURLToPath(import.meta.url)), "..");
const examples = join(docs, "../../examples/plugins");
if (!existsSync(examples)) throw new Error(`build-registry: ${examples} not found (build from the full repository, not from apps/docs alone)`);

const publicDir = join(docs, "public/plugin-shots");
rmSync(publicDir, { recursive: true, force: true });

const registry = [];
for (const id of readdirSync(examples).sort()) {
  const dir = join(examples, id);
  const manifestPath = join(dir, "manifest.json");
  if (!existsSync(manifestPath)) continue;
  let manifest;
  try {
    manifest = parseManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
  } catch (err) {
    console.warn(`registry: "${id}" skipped: ${err.message}`);
    continue;
  }
  const shotsDir = join(dir, "screenshots");
  const shots = existsSync(shotsDir) ? readdirSync(shotsDir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort() : [];
  if (shots.length < MIN_SCREENSHOTS) {
    console.warn(`registry: "${id}" skipped: needs at least ${MIN_SCREENSHOTS} screenshots`);
    continue;
  }
  mkdirSync(join(publicDir, manifest.id), { recursive: true });
  for (const f of shots) cpSync(join(shotsDir, f), join(publicDir, manifest.id, f));
  registry.push({
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    tagline: manifest.tagline ?? "",
    description: manifest.description ?? "",
    author: manifest.author ?? "",
    homepage: manifest.homepage ?? "",
    permissions: manifest.permissions.map((p) => PERMISSION_LABELS[p]),
    connect: manifest.connect ?? [],
    setup: manifest.setup ?? [],
    desktopOnly: manifest.desktopOnly === true,
    soon: manifest.soon === true,
    screenshots: shots.map((f) => `/plugin-shots/${manifest.id}/${f}`),
  });
}
registry.sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(join(docs, "api/_registry.json"), JSON.stringify(registry, null, 2) + "\n");
// The counter functions only need the ids; as code they are bundled with the function (a data file would need tracing).
writeFileSync(join(docs, "api/_ids.ts"), `export const pluginIds: string[] = ${JSON.stringify(registry.map((p) => p.id))};\n`);
console.log(`registry: ${registry.length} plugin(s)`);
