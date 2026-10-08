import express from "express";
import { createContextAwarePool } from "@gestione-dispensa/runtime-db/postgres-client.js";
import { localeCode, normalizeText } from "./text.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

const pool = createContextAwarePool({ connectionString: process.env.DATABASE_URL });
const port = Number(process.env.PORT ?? 3410);
const translationUrl = String(process.env.TRANSLATION_BASE_URL ?? "").replace(/\\/$/, "");
const internalToken = String(process.env.INTERNAL_SERVICE_TOKEN ?? "");

type Candidate = {
  id: string;
  sourceId: string;
  label: string;
  locale: string;
  confidence: number;
};

function scoreCandidate(input: string, row: any): number {
  const normalized = normalizeText(input);
  if (row.normalized === normalized) return row.label_type === "label" ? 1 : 0.98;
  if (String(row.normalized).startsWith(normalized + " ") || normalized.startsWith(String(row.normalized) + " ")) return 0.88;
  return 0.65;
}

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

async function resolveText(input: string, sourceLocale: string, targetLocale: string): Promise<Candidate | null> {
  const normalized = normalizeText(input);
  if (!normalized) return null;

  const direct = await pool.query(
    "SELECT e.id,e.source_id,l.label,l.locale,l.label_type FROM food_semantics.labels l JOIN food_semantics.entities e ON e.id=l.entity_id WHERE l.locale=$1 AND l.normalized=$2 LIMIT 5",
    [sourceLocale, normalized],
  );
  if (direct.rowCount) return {
    id: String(direct.rows[0].id),
    sourceId: String(direct.rows[0].source_id),
    label: String(direct.rows[0].label),
    locale: String(direct.rows[0].locale),
    confidence: String(direct.rows[0].label_type) === "label" ? 1 : 0.98,
  };

  const english = sourceLocale === "en" ? input : await translate(input, sourceLocale, "en");
  if (!english) return null;
  const translatedNormalized = normalizeText(english.text);
  const translated = await pool.query(
    "SELECT e.id,e.source_id,l.label,l.locale,l.label_type FROM food_semantics.labels l JOIN food_semantics.entities e ON e.id=l.entity_id WHERE l.locale='en' AND l.normalized=$1 LIMIT 5",
    [translatedNormalized],
  );
  if (!translated.rowCount) return null;

  const row = translated.rows[0];
  let display = row.label as string;
  let provider = english.provider;
  if (targetLocale !== "en") {
    const localized = await translate(display, "en", targetLocale);
    if (localized) { display = localized.text; provider = localized.provider; }
  }
  return {
    id: String(row.id),
    sourceId: String(row.source_id),
    label: display,
    locale: targetLocale,
    confidence: 0.93,
  };
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
    if (!result) return res.status(200).json({
      status: "UNRESOLVED",
      recipeIngredient: input,
      displayName: input,
      foodEntityId: null,
      canonicalIngredient: null,
      semanticConfidence: 0,
      provenance: "unresolved",
    });
    return res.json({
      status: "RESOLVED",
      recipeIngredient: input,
      displayName: result.label,
      foodEntityId: "foodon:" + result.sourceId,
      canonicalIngredient: result.sourceId,
      semanticConfidence: result.confidence,
      provenance: "foodon",
    });
  } catch (error) {
    return res.status(503).json({ error: { code: "SEMANTIC_RESOLVER_UNAVAILABLE", message: error instanceof Error ? error.message : "Resolver unavailable" } });
  }
});

app.post("/api/v1/resolve/product", async (req, res) => {
  const productId = typeof req.body?.productId === "string" ? req.body.productId.trim() : "";
  const texts = Array.isArray(req.body?.texts) ? req.body.texts.filter((x: unknown): x is string => typeof x === "string" && x.trim()) : [];
  const taxonomyTags = Array.isArray(req.body?.taxonomyTags) ? req.body.taxonomyTags.filter((x: unknown): x is string => typeof x === "string" && x.trim()) : [];
  if (!productId || (!texts.length && !taxonomyTags.length)) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "productId and semantic inputs are required" } });
  try {
    const candidates: Candidate[] = [];
    for (const text of [...texts, ...taxonomyTags]) {
      const result = await resolveText(text, localeCode(req.body?.locale), "it");
      if (result) candidates.push(result);
    }
    candidates.sort((a,b) => b.confidence - a.confidence);
    const best = candidates[0];
    if (!best) return res.json({ status: "UNRESOLVED", foodEntityId: null, semanticConfidence: 0 });
    await pool.query(
      "INSERT INTO food_semantics.product_mappings(product_id,entity_id,source,confidence,evidence) VALUES($1,$2,$3,$4,$5) ON CONFLICT(product_id) DO UPDATE SET entity_id=excluded.entity_id,source=excluded.source,confidence=excluded.confidence,evidence=excluded.evidence,resolved_at=now()",
      [productId, best.id, "catalog", best.confidence, JSON.stringify({ texts, taxonomyTags })],
    );
    return res.json({ status: "RESOLVED", foodEntityId: "foodon:" + best.sourceId, displayName: best.label, semanticConfidence: best.confidence, provenance: "foodon" });
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
