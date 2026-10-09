type ResolverResponse = {
  status: "RESOLVED" | "UNRESOLVED";
  recipeIngredient?: string;
  displayName?: string;
  foodEntityId?: string | null;
  foodEntityAncestors?: string[];
  canonicalIngredient?: string | null;
  semanticConfidence?: number;
  provenance?: string;
};

const baseUrl = () => {
  let value = String(
    process.env.FOOD_SEMANTICS_SERVICE_BASE_URL ??
      "http://service-food-semantics:3410/api/v1",
  );
  while (value.endsWith("/")) value = value.slice(0, -1);
  return value;
};

export async function resolveFoodIngredient(
  text: string,
  locale = "auto",
): Promise<ResolverResponse> {
  const response = await fetch(baseUrl() + "/resolve/ingredient", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ text, locale, targetLocale: "it-IT" }),
    signal: AbortSignal.timeout(Number(process.env.FOOD_SEMANTICS_TIMEOUT_MS ?? 4000)),
  });
  if (!response.ok) throw new Error("food semantics HTTP " + response.status);
  return await response.json() as ResolverResponse;
}
