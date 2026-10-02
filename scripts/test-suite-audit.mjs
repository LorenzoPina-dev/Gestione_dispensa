import { readFile, readdir } from "node:fs/promises";

const required = [
  ["service-identity", ["test/unit.test.ts", "test/http.test.ts", "test/migration.test.ts"]],
  ["service-family", ["test/unit.test.ts", "test/http.test.ts", "test/migration.test.ts", "test/integration.test.ts"]],
  ["service-inventory", ["test/unit.test.ts", "test/http.test.ts", "test/migration.test.ts", "test/integration.test.ts"]],
  ["service-catalog", ["test/unit.test.ts", "test/http.test.ts", "test/migration.test.ts", "test/integration.test.ts"]],
  ["service-shopping", ["test/unit.test.ts", "test/http.test.ts", "test/migration.test.ts", "test/integration.test.ts"]],
  ["service-recipes", ["test/unit.test.ts", "test/http.test.ts", "test/migration.test.ts", "test/integration.test.ts"]],
  ["service-nutrition", ["test/unit.test.ts", "test/http.test.ts", "test/migration.test.ts", "test/integration.test.ts"]],
  ["service-stores", ["test/unit.test.ts", "test/http.test.ts", "test/migration.test.ts", "test/integration.test.ts"]],
  ["service-notifications", ["test/unit.test.ts", "test/http.test.ts", "test/migration.test.ts", "test/integration.test.ts"]],
  ["service-ocr", ["test/unit.test.ts", "test/http.test.ts", "test/migration.test.ts", "test/integration.test.ts"]],
  ["service-shelf-life", ["test/unit.test.ts", "test/http.test.ts", "test/migration.test.ts", "test/integration.test.ts"]],
  ["service-privacy", ["test/unit.test.ts", "test/http.test.ts", "test/migration.test.ts", "test/integration.test.ts"]],
  ["service-jobs", ["test/unit.test.ts", "test/http.test.ts", "test/migration.test.ts", "test/integration.test.ts"]],
  ["gateway", ["test/http.test.mjs", "test/documented-surface.test.mjs"]],
  ["off-lookup", ["test/unit.test.ts", "test/http-client.test.ts", "test/http.test.ts"]],
  ["search-indexer", ["test/unit.test.ts"]],
  ["scheduler", []],
  ["worker-ocr", ["test/unit.test.ts"]],
  ["worker-shelf-life", ["test/unit.test.ts"]],
];

const failures = [];

for (const [service, files] of required) {
  const root = "services/" + service;
  const packageJson = JSON.parse(await readFile(root + "/package.json", "utf8"));
  for (const file of files) {
    try { await readFile(root + "/" + file, "utf8"); }
    catch { failures.push(service + ": missing " + file); }
  }

  const scripts = packageJson.scripts ?? {};
  if (files.length > 0 && !scripts.test) failures.push(service + ": missing npm test script");
  if (files.some((f) => f.includes("/unit.")) && !scripts["test:unit"]) failures.push(service + ": missing test:unit script");
  if (files.some((f) => f.includes("/http.")) && !scripts["test:http"] && service !== "gateway") failures.push(service + ": missing test:http script");
  if (files.some((f) => f.includes("migration.")) && !scripts["test:migration"]) failures.push(service + ": missing test:migration script");
  if (files.some((f) => f.includes("integration.")) && !scripts["test:integration"]) failures.push(service + ": missing test:integration script");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Test suite audit passed: all canonical services expose the required test layers and scripts.");
