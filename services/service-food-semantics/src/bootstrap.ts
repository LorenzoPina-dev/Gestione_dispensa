import { createHash } from "node:crypto";
import { createContextAwarePool } from "@gestione-dispensa/runtime-db/postgres-client.js";

const pool = createContextAwarePool({ connectionString: process.env.DATABASE_URL });
const sourceKey = process.env.FOOD_ONTOLOGY_SOURCE_KEY ?? "foodon";
const sourceUrl = process.env.FOOD_ONTOLOGY_URL ?? "https://purl.obolibrary.org/obo/foodon.owl";
const sourceVersion = process.env.FOOD_ONTOLOGY_VERSION ?? "master";
const license = "CC BY 4.0";

type Term = { id: string; name: string; synonyms: Array<{ text: string; locale: string }>; parent: string | null };

function parseSynonym(value: string): { text: string; locale: string } {
  const quoted = value.match(/"([^"]+)"/);
  const text = quoted?.[1]?.trim() ?? value.trim();
  const locale = value.match(/@([a-z]{2,3})(?:\b|$)/i)?.[1]?.toLowerCase() ?? "en";
  return { text, locale };
}

function parseObo(text: string): Term[] {
  if (text.includes("[Term]")) return parseOboFormat(text);
  return parseOwlFunctionalFormat(text);
}

function parseOboFormat(text: string): Term[] {
  const terms: Term[] = [];
  let current: Partial<Term> | null = null;
  const flush = () => {
    if (current?.id && current.name) {
      terms.push({
        id: current.id,
        name: current.name,
        synonyms: current.synonyms ?? [],
        parent: current.parent ?? null,
      });
    }
    current = null;
  };

  for (const line of text.split(/\r?\n/)) {
    if (line === "[Term]") {
      flush();
      current = { synonyms: [] };
      continue;
    }
    if (!current || line.startsWith("!")) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon);
    const value = line.slice(colon + 1).trim();

    if (key === "id" && /^(FOODON_|FOODON:)/.test(value)) {
      current.id = normalizeFoodOnId(value);
    } else if (key === "name") {
      current.name = value;
    } else if (key === "synonym") {
      current.synonyms!.push(parseSynonym(value));
    } else if (key === "is_a") {
      const parent = value.split("!")[0]!.trim();
      current.parent = normalizeFoodOnId(parent);
    }
  }

  flush();
  return terms.filter((term) => term.id.startsWith("FOODON_"));
}

function parseOwlFunctionalFormat(text: string): Term[] {
  const terms = new Map<string, Term>();

  const ensure = (sourceId: string): Term => {
    const existing = terms.get(sourceId);
    if (existing) return existing;
    const created: Term = { id: sourceId, name: "", synonyms: [], parent: null };
    terms.set(sourceId, created);
    return created;
  };

  const iriToFoodOnId = (iri: string): string | null => {
    const match = iri.match(/(?:https?:\/\/purl\.obolibrary\.org\/obo\/|https?:\/\/www\.ebi\.ac\.uk\/ols\/ontologies\/foodon\/)[^\s>]+/);
    if (!match) return null;
    const local = match[0].split("/").pop() ?? "";
    return /^(?:FOODON_|FOODON:)/.test(local) ? normalizeFoodOnId(local) : null;
  };

  const literalPattern = /"((?:[^"\\]|\\.)*)"(?:@([A-Za-z][A-Za-z0-9-]*))?/;

  const labelRe = /AnnotationAssertion\(rdfs:label\s+<([^>]+)>\s+((?:"(?:[^"\\]|\\.)*"(?:@[A-Za-z][A-Za-z0-9-]*)?))\)/g;
  for (const match of text.matchAll(labelRe)) {
    const sourceId = iriToFoodOnId(match[1]!);
    if (!sourceId) continue;
    const literal = match[2]!.match(literalPattern);
    const label = literal?.[1]?.trim();
    if (label) ensure(sourceId).name = label;
  }

  const synonymRe = /AnnotationAssertion\((?:<[^>]*hasExactSynonym>|<[^>]*hasRelatedSynonym>|oboInOwl:hasExactSynonym|oboInOwl:hasRelatedSynonym)\s+<([^>]+)>\s+((?:"(?:[^"\\]|\\.)*"(?:@[A-Za-z][A-Za-z0-9-]*)?))\)/g;
  for (const match of text.matchAll(synonymRe)) {
    const sourceId = iriToFoodOnId(match[1]!);
    if (!sourceId) continue;
    const literal = match[2]!.match(literalPattern);
    const synonym = literal?.[1]?.trim();
    if (!synonym) continue;
    const locale = literal?.[2]?.toLowerCase() ?? "en";
    ensure(sourceId).synonyms.push({ text: synonym, locale });
  }

  const subclassRe = /SubClassOf\(<([^>]+)>\s+<([^>]+)>\)/g;
  for (const match of text.matchAll(subclassRe)) {
    const child = iriToFoodOnId(match[1]!);
    const parent = iriToFoodOnId(match[2]!);
    if (!child || !parent) continue;
    ensure(child).parent = parent;
  }

  return [...terms.values()].filter((term) => term.name && term.id.startsWith("FOODON_"));
}

function normalizeFoodOnId(value: string): string {
  const trimmed = value.trim();
  const local = trimmed.split("/").pop() ?? trimmed;
  return local.replace(/^FOODON:/, "FOODON_");
}
