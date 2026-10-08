import { createHash } from "node:crypto";
import { createContextAwarePool } from "@gestione-dispensa/runtime-db/postgres-client.js";

const pool = createContextAwarePool({ connectionString: process.env.DATABASE_URL });
const sourceKey = process.env.FOOD_ONTOLOGY_SOURCE_KEY ?? "foodon";
const sourceUrl = process.env.FOOD_ONTOLOGY_URL ?? "https://raw.githubusercontent.com/FoodOntology/foodon/master/foodon_old.obo";
const sourceVersion = process.env.FOOD_ONTOLOGY_VERSION ?? "master";
const license = "CC BY 4.0";

type Term = { id: string; name: string; synonyms: Array<{ text: string; locale: string }>; parent: string | null };

function parseSynonym(value: string): { text: string; locale: string } {
  const quoted = value.match(/"([^"]+)"/);
  const text = quoted?.[1]?.trim() ?? value.trim();
  const locale = value.match(/@([a-z]{2,3})(?:\\b|$)/i)?.[1]?.toLowerCase() ?? "en";
  return { text, locale };
}

function parseObo(text: string): Term[] {
  const terms: Term[] = [];
  let current: Partial<Term> | null = null;
  const flush = () => {
    if (current?.id && current.name) terms.push({
      id: current.id,
      name: current.name,
      synonyms: current.synonyms ?? [],
      parent: current.parent ?? null,
    });
    current = null;
  };
  for (const line of text.split(/\r?\n/)) {
    if (line === "[Term]") { flush(); current = { synonyms: [] }; continue; }
    if (!current || line.startsWith("!")) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon);
    const value = line.slice(colon + 1).trim();
    if (key === "id" && value.startsWith("FOODON_")) current.id = value;
    else if (key === "name") current.name = value;
    else if (key === "synonym") current.synonyms!.push(parseSynonym(value));
    else if (key === "is_a") current.parent = value.split("!")[0]!.trim();
  }
  flush();
  return terms.filter((term) => term.id.startsWith("FOODON_"));
}

async function main(): Promise<void> {
  const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error("FoodOn download failed: HTTP " + response.status);
  const body = await response.text();
  const checksum = createHash("sha256").update(body).digest("hex");
  const terms = parseObo(body);
  if (!terms.length) throw new Error("FoodOn source contained no FOODON terms.");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      "SELECT checksum FROM food_semantics.ontology_sources WHERE source_key=$1",
      [sourceKey],
    );
    if (existing.rowCount && existing.rows[0].checksum === checksum && process.env.FOOD_ONTOLOGY_FORCE_REIMPORT !== "1") {
      await client.query("COMMIT");
      console.log(JSON.stringify({ service: "service-food-semantics", event: "ontology_ready", sourceKey, checksum }));
      return;
    }

    await client.query(
      "DELETE FROM food_semantics.relations WHERE source_entity_id IN (SELECT id FROM food_semantics.entities WHERE source_key=$1)",
      [sourceKey],
    );
    await client.query(
      "DELETE FROM food_semantics.labels WHERE entity_id IN (SELECT id FROM food_semantics.entities WHERE source_key=$1)",
      [sourceKey],
    );

    const ids = new Map<string,string>();
    for (const term of terms) {
      const existing = await client.query(
        "SELECT id FROM food_semantics.entities WHERE source_key=$1 AND source_id=$2",
        [sourceKey, term.id],
      );
      if (existing.rowCount) {
        const entityId = String(existing.rows[0].id);
        await client.query(
          "UPDATE food_semantics.entities SET parent_source_id=$3,entity_type='FOOD' WHERE source_key=$1 AND source_id=$2",
          [sourceKey, term.id, term.parent],
        );
        ids.set(term.id, entityId);
      } else {
        const result = await client.query(
          "INSERT INTO food_semantics.entities(id,source_key,source_id,parent_source_id,entity_type) VALUES(gen_random_uuid(),$1,$2,$3,'FOOD') RETURNING id",
          [sourceKey, term.id, term.parent],
        );
        ids.set(term.id, String(result.rows[0].id));
      }
    }

    let labelCount = 0;
    for (const term of terms) {
      const entityId = ids.get(term.id)!;
      await client.query(
        "INSERT INTO food_semantics.labels(entity_id,locale,label,normalized,label_type) VALUES($1,'en',$2,$3,'label') ON CONFLICT DO NOTHING",
        [entityId, term.name, normalizeText(term.name)],
      );
      labelCount += 1;
      for (const synonym of term.synonyms) {
        const normalized = normalizeText(synonym.text);
        if (!normalized) continue;
        await client.query(
          "INSERT INTO food_semantics.labels(entity_id,locale,label,normalized,label_type) VALUES($1,$2,$3,$4,'synonym') ON CONFLICT DO NOTHING",
          [entityId, synonym.locale, synonym.text, normalized],
        );
        labelCount += 1;
      }
    }

    for (const term of terms) {
      if (!term.parent) continue;
      const entityId = ids.get(term.id);
      if (!entityId || !ids.has(term.parent)) continue;
      await client.query(
        "INSERT INTO food_semantics.relations(source_entity_id,relation,target_source_key,target_source_id) VALUES($1,'IS_A',$2,$3) ON CONFLICT DO NOTHING",
        [entityId, sourceKey, term.parent],
      );
    }

    await client.query(
      "INSERT INTO food_semantics.ontology_sources(id,source_key,version,source_url,license,checksum,entity_count,label_count) VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7) ON CONFLICT(source_key) DO UPDATE SET version=excluded.version,source_url=excluded.source_url,license=excluded.license,checksum=excluded.checksum,entity_count=excluded.entity_count,label_count=excluded.label_count,imported_at=now()",
      [sourceKey, sourceVersion, sourceUrl, license, checksum, terms.length, labelCount],
    );
    await client.query("COMMIT");
    console.log(JSON.stringify({ service: "service-food-semantics", event: "ontology_imported", sourceKey, entities: terms.length, labels: labelCount, checksum }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

function normalizeText(value: unknown): string {
  return (typeof value === "string" ? value : "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

main().catch((error) => {
  console.error(JSON.stringify({ service: "service-food-semantics", event: "ontology_import_failed", error: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
});
