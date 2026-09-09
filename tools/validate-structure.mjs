import { existsSync } from "node:fs";

const requiredPaths = [
  "apps/web",
  "apps/api",
  "services/gateway",
  "services/worker-core",
  "services/worker-integrations",
  "services/worker-notifications",
  "services/scheduler",
  "services/search-indexer",
  "packages/contracts",
  "packages/config",
  "packages/observability",
  "packages/domain",
  "infra/compose",
  "infra/kubernetes",
  "infra/postgres",
  "infra/observability",
  ".github/workflows",
];

const missing = requiredPaths.filter((path) => !existsSync(path));
if (missing.length > 0) {
  console.error(`Missing repository paths:\n${missing.map((path) => `- ${path}`).join("\n")}`);
  process.exit(1);
}

console.log(`Repository structure valid (${requiredPaths.length} required paths).`);
