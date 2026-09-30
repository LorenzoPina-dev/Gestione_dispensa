import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const workspaceRoots = ["services", "packages"];

function readPackage(dir) {
  const path = join(root, dir, "package.json");
  if (!existsSync(path)) return null;
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  return { ...pkg, dir };
}

const workspaces = workspaceRoots.flatMap((rootDir) =>
  readdirSync(join(root, rootDir), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readPackage(join(rootDir, entry.name)))
    .filter(Boolean),
);

const byName = new Map(workspaces.map((pkg) => [pkg.name, pkg]));
const buildable = workspaces.filter((pkg) => typeof pkg.scripts?.build === "string");

const dependenciesOf = (pkg) => {
  const dependencies = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.optionalDependencies,
  };
  return Object.keys(dependencies ?? {})
    .map((name) => byName.get(name))
    .filter((dep) => dep && typeof dep.scripts?.build === "string");
};

const state = new Map();
const ordered = [];

function visit(pkg) {
  const current = state.get(pkg.name);
  if (current === "done") return;
  if (current === "visiting") {
    throw new Error(`Circular build dependency detected at ${pkg.name}`);
  }

  state.set(pkg.name, "visiting");
  for (const dependency of dependenciesOf(pkg)) visit(dependency);
  state.set(pkg.name, "done");
  ordered.push(pkg);
}

for (const pkg of buildable) visit(pkg);

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

for (const pkg of ordered) {
  console.log(`\n==> Building ${pkg.name}`);
  const result = spawnSync(
    npmCommand,
    ["run", "build", "--workspace", pkg.name],
    { cwd: root, stdio: "inherit", shell: false },
  );

  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    process.exit();
  }
}

console.log(`\nBuild completed: ${ordered.length} buildable workspaces.`);
console.log(
  `Skipped ${workspaces.length - buildable.length} source-only workspaces without a build script.`,
);
