import express from "express";
import { createContextAwarePool } from "@gestione-dispensa/runtime-db/postgres-client.js";
import { localeCode, normalizeText } from "./text.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

const pool = createContextAwarePool({ connectionString: process.env.DATABASE_URL });
const port = Number(process.env.PORT ?? 3410);
let translationUrl = String(process.env.TRANSLATION_BASE_URL ?? "");
while (translationUrl.endsWith("/")) translationUrl = translationUrl.slice(0, -1);
const internalToken = String(process.env.INTERNAL_SERVICE_TOKEN ?? "");

type Candidate = {
  id: string;
  sourceId: string;
  label: string;
  locale: string;
  confidence: number;
  ancestors?: string[];
};

async function translate(text: string, source: string, target: string): Promise<{ text: string; provider: string } | null> {
  if (!translationUrl || source === target) return source === target ? { text, provider: "identity" } : null;
  const response = await fetch(translationUrl + "/translate", {
    method: "POST",
    headers: { "content-type": "application/json", ...(internalToken ? { "x-internal-token": internalToken } : {}) },
    body: JSON.stringify({ q: text, source: source || "auto", target, format: "text" }),
    signal: AbortSignal.timeout(Number(process.env.TRANSLATION_TIMEOUT_MS ?? 5000)),
  });
  if (!response.ok) return null;
  const payload = await response.json() as { translatedText?: string };
  return typeof payload.translatedText === "string" && payload.translatedText.trim()
    ? { text: payload.translatedText.trim(), provider: "translation-service" }
    : null;
}

function normalizeTaxonomyInput(value: string): string {
  return value
    .trim()
    .replace(/^[a-z]{2,3}(?:-[a-z0-9]{2,8})?:/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function ancestorIds(entityId: string): Promise<string[]> {
  const result = await pool.query(
    `WITH RECURSIVE ancestors(source_key,source_id) AS (
       SELECT source_key,source_id FROM food_semantics.entities WHERE id=$1
       UNION
       SELECT r.target_source_key,r.target_source_id
         FROM food_semantics.relations r
         JOIN food_semantics.entities child
           ON child.id=r.source_entity_id
         JOIN ancestors a
           ON a.source_key=child.source_key
          AND a.source_id=child.source_id
        WHERE r.relation='IS_A'
     )
     SELECT source_key,source_id FROM ancestors`,
    [entityId],
  );
  return result.rows.map((row) => String(row.source_key) + ":" + String(row.source_id));
}

async function resolveText(input: string, sourceLocale: string, targetLocale: string): Promise<Candidate | null> {
  const normalized = normalizeText(input);
  if (!normalized) return null;

  const cached = await pool.query(
    `SELECT e.id,e.source_id,c.translated_text,c.confidence
       FROM food_semantics.resolution_cache c
       JOIN food_semantics.entities e ON e.id=c.entity_id
      WHERE c.input_normalized=$1 AND c.source_locale=$2 AND c.target_locale=$3
        AND c.status='RESOLVED'
      LIMIT 1`,
    [normalized, sourceLocale, targetLocale],
  );
  if (cached.rowCount) {
    return {
      id: String(cached.rows[0].id),
      sourceId: String(cached.rows[0].source_id),
      label: String(cached.rows[0].translated_text),
      locale: targetLocale,
      confidence: Number(cached.rows[0].confidence),
      ancestors: await ancestorIds(String(cached.rows[0].id)),
    };
  }

  const direct = sourceLocale === "auto"
    ? await pool.query(
        `SELECT e.id,e.source_id,l.label,l.locale,l.label_type
           FROM food_semantics.labels l
           JOIN food_semantics.entities e ON e.id=l.entity_id
          WHERE l.normalized=$1
          ORDER BY CASE WHEN l.locale=$2 THEN 0 WHEN l.locale='en' THEN 1 ELSE 2 END,
                   CASE WHEN l.label_type='label' THEN 0 ELSE 1 END
          LIMIT 5`,
        [normalized, targetLocale],
      )
    : await pool.query(
        "SELECT e.id,e.source_id,l.label,l.locale,l.label_type FROM food_semantics.labels l JOIN food_semantics.entities e ON e.id=l.entity_id WHERE l.locale=$1 AND l.normalized=$2 LIMIT 5",
        [sourceLocale, normalized],
      );
  if (direct.rowCount) {
    const result = {
      id: String(direct.rows[0].id),
      sourceId: String(direct.rows[0].source_id),
      label: String(direct.rows[0].label),
      locale: String(direct.rows[0].locale),
      confidence: String(direct.rows[0].label_type) === "label" ? 1 : 0.98,
      ancestors: await ancestorIds(String(direct.rows[0].id)),
    };
    const display = targetLocale === sourceLocale
      ? result.label
      : (await translate(result.label, sourceLocale, targetLocale))?.text ?? result.label;
    await cacheResolution(normalized, sourceLocale, targetLocale, result.id, display, result.confidence, targetLocale === sourceLocale ? "ontology" : "translation-service");
    return { ...result, label: display, locale: targetLocale };
  }

  const effectiveSourceLocale = sourceLocale === "auto" ? "auto" : sourceLocale;
  const english = effectiveSourceLocale === "en" ? { text: input, provider: "identity" } : await translate(input, effectiveSourceLocale, "en");
  if (!english) return null;
  const translatedNormalized = normalizeText(english.text);

  let translated = await pool.query(
    "SELECT e.id,e.source_id,l.label,l.locale,l.label_type FROM food_semantics.labels l JOIN food_semantics.entities e ON e.id=l.entity_id WHERE l.locale='en' AND l.normalized=$1 LIMIT 5",
    [translatedNormalized],
  );

  if (!translated.rowCount && translatedNormalized.length >= 4) {
    translated = await pool.query(
      `SELECT e.id,e.source_id,l.label,l.locale,l.label_type
         FROM food_semantics.labels l
         JOIN food_semantics.entities e ON e.id=l.entity_id
        WHERE l.locale='en'
          AND similarity(l.normalized,$1) >= 0.82
        ORDER BY similarity(l.normalized,$1) DESC, length(l.normalized) ASC
        LIMIT 3`,
      [translatedNormalized],
    );
  }
  if (!translated.rowCount) return null;

  const row = translated.rows[0];
  const fuzzyConfidence = normalizeText(String(row.label)) === translatedNormalized ? 0.93 : 0.84;
  let display = String(row.label);
  let provider = english.provider;
  if (targetLocale !== "en") {
    const localized = await translate(display, "en", targetLocale);
    if (localized) { display = localized.text; provider = localized.provider; }
  }
  const result = {
    id: String(row.id),
    sourceId: String(row.source_id),
    label: display,
    locale: targetLocale,
    confidence: fuzzyConfidence,
  };
  await cacheResolution(normalized, sourceLocale, targetLocale, result.id, display, fuzzyConfidence, provider);
  return result;
}

async function cacheResolution(
  inputNormalized: string,
  sourceLocale: string,
  targetLocale: string,
  entityId: string,
  translatedText: string,
  confidence: number,
  provider: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO food_semantics.resolution_cache
      (input_text,input_normalized,source_locale,target_locale,entity_id,translated_text,confidence,status,provider,created_at,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,'RESOLVED',$8,now(),now())
     ON CONFLICT(input_normalized,source_locale,target_locale) DO UPDATE SET
       entity_id=excluded.entity_id,
       translated_text=excluded.translated_text,
       confidence=excluded.confidence,
       status=excluded.status,
       provider=excluded.provider,
       updated_at=now()`,
    [inputNormalized, inputNormalized, sourceLocale, targetLocale, entityId, translatedText, confidence, provider],
  );
}


app.get("/health/live", (_req, res) => res.json({ status: "ok", service: "service-food-semantics" }));
app.get("/health/ready", async (_req, res) => {
  try {
    const result = await pool.query("SELECT count(*)::int AS entities FROM food_semantics.entities");
    res.json({ status: result.rows[0].entities > 0 ? "ready" : "degraded", entities: result.rows[0].entities });
  } catch { res.status(503).json({ status: "not_ready" }); }
});

app.post("/api/v1/resolve/ingredient", async (req, res) => {
  const input = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  const sourceLocale = localeCode(req.body?.locale);
  const targetLocale = localeCode(req.body?.targetLocale ?? "it-IT");
  if (!input) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "text is required" } });
  try {
    const result = await resolveText(input, sourceLocale, targetLocale);
    if (!result) {
      let displayName = input;
      try {
        displayName = (await translate(input, "auto", targetLocale))?.text ?? input;
      } catch {
        // Keep the source label when the translation provider is unavailable.
      }
      return res.status(200).json({
        status: "UNRESOLVED",
        recipeIngredient: input,
        displayName,
        foodEntityId: null,
        canonicalIngredient: null,
        semanticConfidence: 0,
        provenance: displayName === input ? "unresolved" : "translation-only",
      });
    }
    return res.json({
      status: "RESOLVED",
      recipeIngredient: input,
      displayName: result.label,
      foodEntityId: "foodon:" + result.sourceId,
      canonicalIngredient: "foodon:" + result.sourceId,
      semanticConfidence: result.confidence,
      foodEntityAncestors: result.ancestors ?? [],
      provenance: "foodon",
    });
  } catch (error) {
    return res.status(503).json({ error: { code: "SEMANTIC_RESOLVER_UNAVAILABLE", message: error instanceof Error ? error.message : "Resolver unavailable" } });
  }
});

app.post("/api/v1/resolve/product", async (req, res) => {
  const productId = typeof req.body?.productId === "string" ? req.body.productId.trim() : "";
  const texts = Array.isArray(req.body?.texts) ? req.body.texts.filter((x: unknown): x is string => typeof x === "string" && Boolean(x.trim())) : [];
  const taxonomyTags = Array.isArray(req.body?.taxonomyTags)
    ? req.body.taxonomyTags
        .filter((x: unknown): x is string => typeof x === "string" && Boolean(x.trim()))
        .map(normalizeTaxonomyInput)
        .filter(Boolean)
    : [];
  if (!productId || (!texts.length && !taxonomyTags.length)) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "productId and semantic inputs are required" } });
  try {
    const candidates: Candidate[] = [];
    for (const text of [...texts, ...taxonomyTags]) {
      const result = await resolveText(text, "auto", "it");
      if (result) candidates.push(result);
    }
    candidates.sort((a,b) => b.confidence - a.confidence);
    const best = candidates[0];
    if (!best) return res.json({ status: "UNRESOLVED", foodEntityId: null, semanticConfidence: 0 });
    await pool.query(
      "INSERT INTO food_semantics.product_mappings(product_id,entity_id,source,confidence,evidence) VALUES($1,$2,$3,$4,$5) ON CONFLICT(product_id) DO UPDATE SET entity_id=excluded.entity_id,source=excluded.source,confidence=excluded.confidence,evidence=excluded.evidence,resolved_at=now()",
      [productId, best.id, "catalog", best.confidence, JSON.stringify({ texts, taxonomyTags })],
    );
    return res.json({ status: "RESOLVED", foodEntityId: "foodon:" + best.sourceId, foodEntityAncestors: best.ancestors ?? [], displayName: best.label, semanticConfidence: best.confidence, provenance: "foodon" });
  } catch (error) {
    return res.status(503).json({ error: { code: "SEMANTIC_RESOLVER_UNAVAILABLE", message: error instanceof Error ? error.message : "Resolver unavailable" } });
  }
});

app.get("/api/v1/entities/:id", async (req, res) => {
  const sourceId = req.params.id.replace(/^foodon:/, "");
  const row = await pool.query(
    "SELECT e.source_id,l.locale,l.label,l.label_type FROM food_semantics.entities e JOIN food_semantics.labels l ON l.entity_id=e.id WHERE e.source_id=$1 ORDER BY l.locale,l.label_type",
    [sourceId],
  );
  if (!row.rowCount) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Food entity not found" } });
  res.json({ foodEntityId: "foodon:" + sourceId, labels: row.rows });
});

app.listen(port, "0.0.0.0", () => console.log(JSON.stringify({ service: "service-food-semantics", port, event: "http_listening" })));
