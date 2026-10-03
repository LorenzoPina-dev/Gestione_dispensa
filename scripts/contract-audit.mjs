import { readFile, readdir } from "node:fs/promises";

const api = await readFile("docs/API.md", "utf8");
const openapi = await readFile("docs/openapi.yaml", "utf8");

function apiPaths(text) {
  return new Set([...text.matchAll(/^###\s+(GET|POST|PATCH|PUT|DELETE)\s+(\/\S+)/gm)].map((m) => m[1] + " " + m[2].replaceAll("`", "")));
}

function openapiPaths(text) {
  const result = new Set();
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/^  (\/[^:]+):\s*$/);
    if (!match) continue;
    const path = match[1];
    for (let j = i + 1; j < lines.length; j += 1) {
      if (/^  \//.test(lines[j]) || /^components:/.test(lines[j])) break;
      const operation = lines[j].match(/^    (get|post|patch|put|delete):\s*$/i);
      if (operation) result.add(operation[1].toUpperCase() + " " + path);
    }
  }
  return result;
}

const documented = apiPaths(api);
const machine = openapiPaths(openapi);
const internalOnly = (operation) =>
  operation.startsWith("GET /api/v1/internal/") ||
  operation.startsWith("GET /api/v1/search") ||
  operation.startsWith("PUT /api/v1/off/") ||
  operation.startsWith("POST /api/v1/off/");
const onlyDocs = [...documented].filter((x) => !machine.has(x) && !internalOnly(x)).sort();
const onlyOpenApi = [...machine].filter((x) => !documented.has(x)).sort();

const legacyPatterns = [
  /\/shopping-lists(?:\/|["\x27`])/,
  /\/inventory\/stock-items(?:\/|["\x27`])/,
  /\/products\/resolve-barcode(?:\/|["\x27`])/,
  /\/catalog\/lookup(?:\/|["\x27`])/,
  /\/auth\/me(?:\/|["\x27`])/,
  /\/ocr-jobs(?:\/|["\x27`])/,
  /\/shelf-life\/predict(?:\/|["\x27`])/,
];

const roots = [
  "apps/web/src",
  "services/gateway/src",
  "services/service-identity/src",
  "services/service-family/src",
  "services/service-inventory/src",
  "services/service-catalog/src",
  "services/service-shopping/src",
  "services/service-recipes/src",
  "services/service-nutrition/src",
  "services/service-stores/src",
  "services/service-notifications/src",
  "services/service-ocr/src",
  "services/service-shelf-life/src",
];

async function walk(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = root + "/" + entry.name;
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) files.push(full);
  }
  return files;
}

const legacyHits = [];
for (const root of roots) {
  for (const file of await walk(root)) {
    const raw = await readFile(file, "utf8");
    const text = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "");
    if (legacyPatterns.some((pattern) => pattern.test(text))) legacyHits.push(file);
  }
}

// Physical schema coverage: every table introduced by a service migration must be represented in DATA.md.
const data = await readFile("docs/DATA.md", "utf8");
const migrationRoots = (await readdir("services", { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => "services/" + entry.name);
const physicalTables = new Set();
const migrationServices = [];
for (const serviceRoot of migrationRoots) {
  const migrationsDir = serviceRoot + "/migrations";
  try {
    const files = await readdir(migrationsDir);
    if (!files.some((file) => /^\d+_.+\.sql$/.test(file))) continue;
    migrationServices.push(serviceRoot);
    for (const file of files.filter((name) => /^\d+_.+\.sql$/.test(name))) {
      const sql = await readFile(migrationsDir + "/" + file, "utf8");
      const sqlWithoutComments = sql
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|\s)--.*$/gm, "");
      for (const match of sqlWithoutComments.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-zA-Z0-9_.]+)/gi)) {
        physicalTables.add(match[1].toLowerCase());
      }
    }
  } catch {
    // Service has no migrations directory.
  }
}
const technicalTables = new Set(["schema_migrations", "outbox_events", "idempotency_keys"]);
const dataMissingTables = [...physicalTables].filter((table) => !technicalTables.has(table) && !data.toLowerCase().includes(table));

// Migration startup contract: every service with migrations must ship a runner and execute it in Docker.
const migrationRuntimeMissing = [];
for (const serviceRoot of migrationServices) {
  const migratePath = serviceRoot + "/src/migrate.ts";
  const dockerPath = serviceRoot + "/Dockerfile";
  try {
    await readFile(migratePath, "utf8");
    const docker = await readFile(dockerPath, "utf8");
    let startup = docker;
    if (docker.includes("docker-entrypoint.sh")) {
      try { startup += "\n" + await readFile(serviceRoot + "/docker-entrypoint.sh", "utf8"); } catch {}
    }
    if (docker.includes("entrypoint.sh")) {
      try { startup += "\n" + await readFile(serviceRoot + "/entrypoint.sh", "utf8"); } catch {}
    }
    if (!startup.includes("dist/migrate.js")) {
      migrationRuntimeMissing.push(serviceRoot + ": Docker startup does not run dist/migrate.js");
    }
  } catch {
    migrationRuntimeMissing.push(serviceRoot + ": missing migrate.ts or Dockerfile");
  }
}

if (onlyDocs.length || onlyOpenApi.length || legacyHits.length || dataMissingTables.length || migrationRuntimeMissing.length) {
  console.error(JSON.stringify({ onlyDocs, onlyOpenApi, legacyHits, dataMissingTables, migrationRuntimeMissing }, null, 2));
  process.exit(1);
}
console.log("Contract audit passed: " + documented.size + " documented operations match OpenAPI; " + physicalTables.size + " physical tables are covered by DATA.md; migrations have runtime startup coverage; no legacy application paths were found.");
