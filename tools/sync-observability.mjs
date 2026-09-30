#!/usr/bin/env node
/**
 * Keeps every service's `src/observability.ts` byte-identical to the single source of truth,
 * `packages/observability/src/service-runtime.ts`.
 *
 * Why copies and not a package import: each service Dockerfile copies only its own workspace
 * (see the Dockerfile of each service), so a cross-package import would not compile inside the image.
 * This mirrors how `db/`, `http/` and `identity/` are already kept per service.
 *
 *   node tools/sync-observability.mjs          write/refresh all copies
 *   node tools/sync-observability.mjs --check  exit 1 if any copy is missing or drifted (CI)
 *
 * To observe a new service: add its folder name to OBSERVED_SERVICES and run the script.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OBSERVED_SERVICES = [
  "gateway",
  "off-lookup",
  "service-catalog",
  "service-family",
  "service-identity",
  "service-inventory",
  "service-jobs",
  "service-notifications",
  "service-ocr",
  "service-privacy",
  "service-nutrition",
  "service-recipes",
  "service-shelf-life",
  "service-shopping",
  "service-stores",
];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "packages", "observability", "src", "service-runtime.ts");
const check = process.argv.includes("--check");

const normalize = (text) => text.replace(/\r\n/g, "\n");
const source = normalize(await readFile(sourcePath, "utf8"));

let problems = 0;
for (const service of OBSERVED_SERVICES) {
  const target = path.join(root, "services", service, "src", "observability.ts");
  const current = await readFile(target, "utf8").then(normalize, () => undefined);
  if (current === source) continue;

  if (check) {
    problems += 1;
    console.error(`${current === undefined ? "MISSING" : "DRIFTED"}: services/${service}/src/observability.ts`);
    continue;
  }
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, source, "utf8");
  console.log(`${current === undefined ? "created" : "updated"}: services/${service}/src/observability.ts`);
}

if (check && problems > 0) {
  console.error(`\n${problems} copy(ies) out of sync. Run: npm run obs:sync`);
  process.exit(1);
}
if (check) console.log(`observability copies in sync (${OBSERVED_SERVICES.length} services)`);
