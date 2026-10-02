import { readFile, stat } from "node:fs/promises";

const canonical = [
  ["service-identity", 3310],
  ["service-family", 3311],
  ["service-inventory", 3312],
  ["service-shopping", 3313],
  ["service-catalog", 3314],
  ["service-notifications", 3315],
  ["service-privacy", 3316],
  ["service-jobs", 3317],
  ["service-recipes", 3401],
  ["service-nutrition", 3402],
  ["service-stores", 3403],
  ["service-shelf-life", 3404],
  ["service-ocr", 3405],
  ["off-lookup", 3200],
];

const sqlMigrationServices = canonical
  .map(([name]) => String(name))
  .filter((name) => name !== "off-lookup");

const compose = await readFile("docker-compose.yml", "utf8");
const data = await readFile("docs/DATA.md", "utf8");
const servicesDoc = await readFile("docs/SERVICES.md", "utf8");
const architectureDoc = await readFile("docs/ARCHITECTURE.md", "utf8");
const failures = [];

function hasComposeService(name) {
  return new RegExp("^  " + name.replace(/[.*+?^(){}|[\]\\]/g, "\\$&") + ":\\s*$", "m").test(compose);
}
function composeBlock(name) {
  const escaped = name.replace(/[.*+?^(){}|[\]\\]/g, "\\$&");
  return compose.match(new RegExp("^  " + escaped + ":[\\s\\S]*?(?=^  [a-zA-Z0-9_-]+:|^volumes:|^networks:|\\Z)", "m"))?.[0] ?? "";
}

for (const [name, port] of canonical) {
  const root = "services/" + name;
  for (const required of ["package.json", "Dockerfile", "src"]) {
    try { await stat(root + "/" + required); } catch { failures.push(name + ": missing " + required); }
  }
  if (name !== "off-lookup") {
    try { await stat(root + "/migrations"); } catch { failures.push(name + ": missing migrations"); }
    try { await stat(root + "/src/migrate.ts"); } catch { failures.push(name + ": missing src/migrate.ts"); }
  }
  if (!hasComposeService(name)) {
    failures.push(name + ": missing from docker-compose.yml");
    continue;
  }
  const block = composeBlock(name);
  if (!block.includes("healthcheck:")) failures.push(name + ": missing healthcheck");
  if (!block.includes("restart:")) failures.push(name + ": missing restart policy");
  if (name !== "off-lookup" && !block.includes("DATABASE_URL:")) failures.push(name + ": missing dedicated DATABASE_URL");
  if (name !== "off-lookup" && !block.includes("dist/migrate.js")) failures.push(name + ": Docker startup does not execute migrations");
  if (block.includes("ports:")) failures.push(name + ": application service must not publish host ports");
  if (!block.includes("PORT: " + port)) failures.push(name + ": canonical port " + port + " is not configured");
}

const dbUrls = [];
for (const [name] of canonical) {
  const block = composeBlock(name);
  const match = block.match(/DATABASE_URL:\s*["']?([^"'\s]+)["']?/);
  if (match) dbUrls.push([name, match[1]]);
}
const duplicates = new Map();
for (const [name, url] of dbUrls) {
  const bucket = duplicates.get(url) ?? [];
  bucket.push(name);
  duplicates.set(url, bucket);
}
for (const [url, names] of duplicates) {
  if (names.length > 1) failures.push("shared DATABASE_URL between services: " + names.join(", ") + " -> " + url);
}

if (!hasComposeService("worker-shelf-life") || !hasComposeService("worker-ocr")) {
  failures.push("runtime async foundation workers are missing from docker-compose.yml");
}

if (compose.includes("gestione_dispensa-service-inventory-1") && !compose.includes("service-inventory:")) {
  failures.push("compose inventory identity mismatch");
}

for (const legacy of ["apps/api", "services/server", "services/families", "services/users", "services/products"]) {
  try { await stat(legacy); failures.push("legacy implementation directory must be absent: " + legacy); } catch {}
}

if (!data.includes("target_days") || !data.includes("shelf_life_domain.product_profiles")) {
  failures.push("DATA.md is missing the current Shelf-Life schema contract");
}
if (!servicesDoc.includes("database isolation") && !servicesDoc.includes("Database isolation")) {
  failures.push("SERVICES.md is missing database-isolation contract");
}
if (!architectureDoc.includes("database-per-service")) {
  failures.push("ARCHITECTURE.md is missing database-per-service rule");
}

for (const service of sqlMigrationServices) {
  const docker = await readFile("services/" + service + "/Dockerfile", "utf8");
  if (!docker.includes("dist/migrate.js") && !docker.includes("docker-entrypoint.sh")) {
    failures.push(service + ": migration startup contract not visible in Dockerfile");
  }
}

if (failures.length) {
  console.error(JSON.stringify({ architectureAudit: "failed", failures }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({
  architectureAudit: "passed",
  canonicalServices: canonical.length,
  databasePerService: true,
  migrationStartupChecked: sqlMigrationServices.length,
  runtimeWorkers: ["worker-shelf-life", "worker-ocr"],
}, null, 2));
