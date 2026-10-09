/**
 * Canonical quantity units shared by Inventory, Shopping, Catalog and Recipes (docs/API.md).
 *
 * Pure helpers: no I/O and no framework imports, so they run under node:test like the other
 * journeys in this folder. The backend only accepts the canonical units; the UI is free to show
 * friendlier labels through `formatUnit`.
 */

export type CanonicalUnit = "g" | "kg" | "ml" | "l" | "piece" | "pack";
export type UnitFamily = "mass" | "volume" | "count";

const ALIASES: Readonly<Record<string, CanonicalUnit>> = {
  g: "g",
  gr: "g",
  grammo: "g",
  grammi: "g",
  kg: "kg",
  chilo: "kg",
  chili: "kg",
  chilogrammo: "kg",
  chilogrammi: "kg",
  ml: "ml",
  millilitro: "ml",
  millilitri: "ml",
  l: "l",
  lt: "l",
  litro: "l",
  litri: "l",
  piece: "piece",
  pieces: "piece",
  pz: "piece",
  pezzo: "piece",
  pezzi: "piece",
  pack: "pack",
  conf: "pack",
  "conf.": "pack",
  confezione: "pack",
  confezioni: "pack",
};

const FAMILY: Readonly<Record<CanonicalUnit, UnitFamily>> = {
  g: "mass",
  kg: "mass",
  ml: "volume",
  l: "volume",
  piece: "count",
  pack: "count",
};

const TO_BASE: Readonly<Record<CanonicalUnit, number>> = {
  g: 1,
  kg: 1000,
  ml: 1,
  l: 1000,
  piece: 1,
  pack: 1,
};

const STEP: Readonly<Record<CanonicalUnit, number>> = {
  g: 100,
  kg: 0.5,
  ml: 100,
  l: 0.5,
  piece: 1,
  pack: 1,
};

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Maps any known spelling ("pz", "Litri", "conf.") to a unit the backend accepts. */
export function normalizeUnit(
  unit: string | null | undefined,
  fallback: CanonicalUnit = "piece",
): CanonicalUnit {
  const key = String(unit ?? "").trim().toLowerCase();
  return ALIASES[key] ?? fallback;
}

export function isKnownUnit(unit: string | null | undefined): boolean {
  return ALIASES[String(unit ?? "").trim().toLowerCase()] !== undefined;
}

export function unitFamily(unit: CanonicalUnit): UnitFamily {
  return FAMILY[unit];
}

/**
 * Converts inside the same family (kg <-> g, l <-> ml). Count units are never converted into each
 * other ("piece" is not "pack") and incompatible families return `null`: Inventory does not
 * convert units implicitly (docs/DATA.md, Inventory invariants) and neither do we.
 */
export function convertQuantity(quantity: number, from: CanonicalUnit, to: CanonicalUnit): number | null {
  if (from === to) return quantity;
  if (FAMILY[from] !== FAMILY[to] || FAMILY[from] === "count") return null;
  return round3((quantity * TO_BASE[from]) / TO_BASE[to]);
}

/** Increment used by the quantity stepper: 1 for countables, 100 for g/ml, 0.5 for kg/l. */
export function quantityStep(unit: CanonicalUnit): number {
  return STEP[unit];
}

/** Rounds up to a whole number of steps, never below one step. */
export function roundUpToStep(value: number, unit: CanonicalUnit): number {
  const step = STEP[unit];
  if (!Number.isFinite(value) || value <= 0) return step;
  return round3(Math.ceil(round3(value / step)) * step);
}

/** Display label: the data stays canonical ("piece"), the screen reads "pz". */
export function formatUnit(unit: string | null | undefined): string {
  const raw = String(unit ?? "").trim();
  const canonical = ALIASES[raw.toLowerCase()];
  if (canonical === undefined) return raw;
  if (canonical === "piece") return "pz";
  if (canonical === "pack") return "conf.";
  return canonical;
}

/** Italian-style decimal: 1.5 -> "1,5". Integers stay integers. */
export function formatQuantity(quantity: number): string {
  if (!Number.isFinite(quantity)) return "0";
  if (Number.isInteger(quantity)) return String(quantity);
  return round3(quantity).toString().replace(".", ",");
}
