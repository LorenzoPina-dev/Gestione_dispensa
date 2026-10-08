import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createContextAwarePool } from "@gestione-dispensa/runtime-db/postgres-client.js";

const DATASET_URL = process.env.RECIPE_DATASET_URL ??
  "https://zenodo.org/api/records/14068000/files/italian%20gastronomic%20recipes%20dataset.zip/content";
const DATASET_MD5 = "b90427179a4304270fd5b7b7490b565d";
const DATASET_KEY = "italian-gastronomic-recipes-v4";
const SOURCE = "italian-gastronomic-recipes-v4";
const WORK_DIR = "/tmp/italian-recipes";

type CsvRow = string[];

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCsv(text: string): CsvRow[] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = firstLine.split(";").length > firstLine.split(",").length ? ";" : ",";
  const rows: CsvRow[] = [];
  let row: CsvRow = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === delimiter && !quoted) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.some((value: string) => value.trim() !== "")) rows.push(row);
      row = [];
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((value: string) => value.trim() !== "")) rows.push(row);
  }

  return rows;
}

function findFile(root: string, fileName: string): string {
  const stack: string[] = [root];

  while (stack.length > 0) {
    const directory = stack.pop() as string;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) stack.push(candidate);
      else if (entry.name.toLowerCase() === fileName.toLowerCase()) return candidate;
    }
  }

  throw new Error(fileName + " not found in recipe dataset.");
}

function parseNumber(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function deterministicUuid(sourceId: string): string {
  const bytes = Buffer.from(
    createHash("sha256").update(SOURCE + ":" + sourceId).digest("hex").slice(0, 32),
    "hex",
  );
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function ingredientTerms(value: string): string[] {
  const normalized = normalize(value);
  return [...new Set([normalized, ...normalized.split(" ").filter((token: string) => token.length >= 3)])];
}

function columnIndex(headers: string[], names: string[]): number {
  for (const name of names) {
    const index = headers.indexOf(normalize(name));
    if (index >= 0) return index;
  }
  return -1;
}

async function main(): Promise<void> {
  const pool = createContextAwarePool({ connectionString: process.env.DATABASE_URL });

  const existing = await pool.query(
    "SELECT source_md5, recipe_count FROM recipe_catalog.datasets WHERE dataset_key=$1",
    [DATASET_KEY],
  );

  if (
    existing.rowCount &&
    String(existing.rows[0].source_md5) === DATASET_MD5 &&
    Number(existing.rows[0].recipe_count) > 0 &&
    process.env.RECIPE_DATASET_FORCE_REIMPORT !== "1"
  ) {
    console.log(JSON.stringify({
      service: "recipe-catalog-import",
      event: "recipe_dataset_ready",
      recipes: Number(existing.rows[0].recipe_count),
      cached: true,
    }));
    await pool.end();
    return;
  }

  mkdirSync(WORK_DIR, { recursive: true });
  const zipPath = path.join(WORK_DIR, "dataset.zip");
  const extractedPath = path.join(WORK_DIR, "dataset");
  rmSync(extractedPath, { recursive: true, force: true });

  const downloadUrls = [
    DATASET_URL,
    "https://zenodo.org/records/14068000/files/italian%20gastronomic%20recipes%20dataset.zip?download=1",
    "https://zenodo.org/records/14068000/files/italian%20gastronomic%20recipes%20dataset.zip",
  ].filter((value, index, values) => values.indexOf(value) === index);

  let data: Buffer | null = null;
  let lastStatus: number | null = null;

  for (const downloadUrl of downloadUrls) {
    const response = await fetch(downloadUrl, {
      headers: {
        Accept: "application/zip,application/octet-stream;q=0.9,*/*;q=0.8",
        "User-Agent": "Gestione-Dispensa/2.0 recipe-catalog-import",
        Referer: "https://zenodo.org/records/14068000",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(120_000),
    });

    if (response.ok) {
      data = Buffer.from(await response.arrayBuffer());
      break;
    }

    lastStatus = response.status;
    console.warn(JSON.stringify({
      service: "recipe-catalog-import",
      event: "recipe_dataset_download_attempt_failed",
      status: response.status,
      url: downloadUrl,
    }));
  }

  if (!data) {
    throw new Error("Recipe dataset download failed with HTTP " + String(lastStatus ?? "unknown"));
  }
  const md5 = createHash("md5").update(data).digest("hex");
  if (md5 !== DATASET_MD5) {
    throw new Error("Recipe dataset MD5 mismatch: expected " + DATASET_MD5 + ", got " + md5);
  }

  writeFileSync(zipPath, data);
  mkdirSync(extractedPath, { recursive: true });
  execFileSync("unzip", ["-q", "-o", zipPath, "-d", extractedPath], { stdio: "inherit" });

  const rows = parseCsv(readFileSync(findFile(extractedPath, "recipes.csv"), "utf8"));
  if (rows.length < 2) throw new Error("Recipe dataset recipes.csv is empty.");

  const headers = rows[0].map(normalize);
  const idColumn = columnIndex(headers, ["id"]);
  const titleColumn = columnIndex(headers, ["name"]);
  const categoryColumn = columnIndex(headers, ["category name"]);
  const costColumn = columnIndex(headers, ["cost"]);
  const difficultyColumn = columnIndex(headers, ["difficulty"]);
  const timeColumn = columnIndex(headers, ["preparation time"]);
  const linkColumn = columnIndex(headers, ["link"]);
  const ingredientColumns = headers.map((header: string, index: number) => header === "ingredient" ? index : -1).filter((index: number) => index >= 0);
  const ingredientIdColumns = headers.map((header: string, index: number) => header === "ingredient id" ? index : -1).filter((index: number) => index >= 0);
  const weightColumns = headers.map((header: string, index: number) => header === "weight" || header === "w" ? index : -1).filter((index: number) => index >= 0);
  const preparationColumns = headers.map((header: string, index: number) => header === "preparation" ? index : -1).filter((index: number) => index >= 0);

  if (idColumn < 0 || titleColumn < 0 || ingredientColumns.length === 0) {
    throw new Error("Unexpected recipes.csv schema: required columns are missing.");
  }

  const client = await pool.connect();
  let imported = 0;

  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM recipe_catalog.recipes WHERE source=$1", [SOURCE]);

    for (const row of rows.slice(1)) {
      const sourceRecipeId = (row[idColumn] ?? "").trim();
      const title = (row[titleColumn] ?? "").trim();
      if (!sourceRecipeId || !title) continue;

      const recipeId = deterministicUuid(sourceRecipeId);
      await client.query(
        "INSERT INTO recipe_catalog.recipes(id,source,source_recipe_id,title,category,cost,difficulty,prep_time_minutes,source_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          recipeId,
          SOURCE,
          sourceRecipeId,
          title,
          categoryColumn >= 0 ? row[categoryColumn] || null : null,
          costColumn >= 0 ? parseNumber(row[costColumn]) : null,
          difficultyColumn >= 0 ? parseNumber(row[difficultyColumn]) : null,
          timeColumn >= 0 ? parseNumber(row[timeColumn]) : null,
          linkColumn >= 0 ? row[linkColumn] || null : null,
        ],
      );

      let ingredientPosition = 0;
      for (let j = 0; j < ingredientColumns.length; j += 1) {
        const name = (row[ingredientColumns[j]] ?? "").trim();
        if (!name) continue;

        ingredientPosition += 1;
        await client.query(
          "INSERT INTO recipe_catalog.recipe_ingredients(id,recipe_id,position,source_ingredient_id,name,display_name,weight,terms) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            randomUUID(),
            recipeId,
            ingredientPosition,
            ingredientIdColumns[j] !== undefined ? (row[ingredientIdColumns[j]] ?? "").trim() || null : null,
            name,
            name,
            weightColumns[j] !== undefined ? parseNumber(row[weightColumns[j]]) : null,
            ingredientTerms(name),
          ],
        );
      }

      let stepPosition = 0;
      for (const preparationColumn of preparationColumns) {
        const instruction = (row[preparationColumn] ?? "").trim();
        if (!instruction) continue;

        stepPosition += 1;
        await client.query(
          "INSERT INTO recipe_catalog.recipe_steps(id,recipe_id,position,instruction) VALUES($1,$2,$3,$4)",
          [randomUUID(), recipeId, stepPosition, instruction],
        );
      }

      imported += 1;
      if (imported % 250 === 0) {
        console.log(JSON.stringify({
          service: "recipe-catalog-import",
          event: "recipe_dataset_progress",
          recipes: imported,
        }));
      }
    }

    await client.query(
      "INSERT INTO recipe_catalog.datasets(dataset_key,source_url,source_md5,recipe_count) VALUES($1,$2,$3,$4) ON CONFLICT(dataset_key) DO UPDATE SET source_url=excluded.source_url,source_md5=excluded.source_md5,recipe_count=excluded.recipe_count,imported_at=now()",
      [DATASET_KEY, DATASET_URL, DATASET_MD5, imported],
    );
    await client.query("COMMIT");

    console.log(JSON.stringify({
      service: "recipe-catalog-import",
      event: "recipe_dataset_imported",
      recipes: imported,
    }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
    rmSync(WORK_DIR, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({
    service: "recipe-catalog-import",
    event: "recipe_dataset_import_failed",
    error: error instanceof Error ? error.message : String(error),
  }));
  process.exit(1);
});
