import { readFileSync } from "node:fs";

// One page per plugin in the registry (see scripts/build-registry.mjs).
export default {
  paths() {
    const registry = JSON.parse(readFileSync(new URL("../api/_registry.json", import.meta.url), "utf8"));
    return registry.map((params) => ({ params }));
  },
};
