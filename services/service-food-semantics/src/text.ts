export function normalizeText(value: unknown): string {
  return (typeof value === "string" ? value : "")
    .normalize("NFD")
    .replace(/[\\u0300-\\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\\s+/g, " ")
    .trim();
}

export function localeCode(locale: string | undefined): string {
  return String(locale || "it-IT").split("-")[0]!.toLowerCase();
}
