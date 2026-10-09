import { readFile, readdir } from "node:fs/promises";

const roots = ["services", "apps", "packages"];
const forbiddenInIntegration = [
  /\bvi\.mock\s*\(/,
  /\bjest\.mock\s*\(/,
  /\bsinon\.(stub|mock|replace)\s*\(/,
  /\bnock\s*\(/,
  /from ["']mock-fs["']/,
];
const discovered = [];

async function walk(root) {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = root + "/" + entry.name;
    if (entry.isDirectory()) await walk(full);
    else if (/\.test\.(ts|tsx|js|mjs)$/.test(entry.name)) discovered.push(full);
  }
}

for (const root of roots) await walk(root);

const violations = [];
for (const file of discovered) {
  const raw = await readFile(file, "utf8");
  const normalized = file.replaceAll("\\", "/");
  if (!normalized.includes("/integration") && !normalized.includes("/e2e") && !normalized.includes("/contract")) continue;
  for (const pattern of forbiddenInIntegration) {
    if (pattern.test(raw)) violations.push({ file, pattern: pattern.source });
  }
}

if (violations.length) {
  console.error(JSON.stringify({ violations }, null, 2));
  process.exit(1);
}
console.log(`Test policy audit passed: ${discovered.length} test files scanned; no mocking framework detected in integration/contract/e2e suites.`);
