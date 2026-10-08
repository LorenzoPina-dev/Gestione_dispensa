export type CulinaryWeight = "STAPLE" | "SECONDARY" | "CORE";

export interface ProductFoodSemantics {
  productId: string;
  canonicalIngredient: string | null;
  ingredientTerms: string[];
  taxonomyTags: string[];
  allergenTags: string[];
  traceTags: string[];
  labelTags: string[];
  dietaryTags: string[];
  culinaryWeight: CulinaryWeight;
  quantity: { value: number; unit: string } | null;
  quantityBase: { value: number; unit: "g" | "ml" | "piece" } | null;
  quantityConfidence: number;
  semanticConfidence: number;
  source: string;
  sourceVersion: string;
  observedAt: string;
}

const ALIAS_GROUPS: Record<string, string[]> = {
  "pomodoro": ["pomodoro", "pomodori", "tomato", "tomatoes", "tomate", "tomates"],
  "cipolla": ["cipolla", "cipolle", "onion", "onions"],
  "aglio": ["aglio", "garlic"],
  "patata": ["patata", "patate", "potato", "potatoes"],
  "carota": ["carota", "carote", "carrot", "carrots"],
  "zucchina": ["zucchina", "zucchine", "zucchini", "courgette", "courgettes"],
  "melanzana": ["melanzana", "melanzane", "eggplant", "eggplants", "aubergine"],
  "peperone": ["peperone", "peperoni", "bell pepper", "bell peppers"],
  "pollo": ["pollo", "chicken"],
  "manzo": ["manzo", "beef", "boeuf"],
  "maiale": ["maiale", "pork"],
  "pancetta": ["pancetta", "bacon"],
  "prosciutto": ["prosciutto", "ham"],
  "tonno": ["tonno", "tuna"],
  "salmone": ["salmone", "salmon"],
  "uovo": ["uovo", "uova", "egg", "eggs"],
  "latte": ["latte", "milk"],
  "burro": ["burro", "butter"],
  "panna": ["panna", "cream"],
  "formaggio": ["formaggio", "formaggi", "cheese", "cheeses"],
  "mozzarella": ["mozzarella"],
  "parmigiano": ["parmigiano", "parmesan"],
  "pecorino": ["pecorino"],
  "farina": ["farina", "flour"],
  "pane": ["pane", "bread"],
  "pangrattato": ["pangrattato", "breadcrumbs"],
  "pasta": ["pasta", "rigatoni", "penne", "fusilli", "farfalle", "spaghetti", "linguine", "bucatini", "tagliatelle", "fettuccine", "maccheroni", "orecchiette", "paccheri", "lasagne", "lasagna"],
  "riso": ["riso", "rice"],
  "ceci": ["cece", "ceci", "chickpea", "chickpeas"],
  "fagioli": ["fagiolo", "fagioli", "bean", "beans"],
  "piselli": ["pisello", "piselli", "pea", "peas"],
  "mais": ["mais", "corn"],
  "olive": ["oliva", "olive", "olives"],
  "olio extravergine": ["olio extravergine", "olio evo", "extra virgin olive oil", "extra-virgin olive oil"],
  "olio": ["olio", "oil"],
  "sale": ["sale", "salt"],
  "acqua": ["acqua", "water"],
  "basilico": ["basilico", "basil"],
  "prezzemolo": ["prezzemolo", "parsley"],
  "rosmarino": ["rosmarino", "rosemary"],
  "limone": ["limone", "limoni", "lemon", "lemons"],
  "zucchero": ["zucchero", "sugar"],
  "cacao": ["cacao", "cocoa"],
  "cioccolato": ["cioccolato", "chocolate"],
  "miele": ["miele", "honey"],
  "mandorle": ["mandorla", "mandorle", "almond", "almonds"],
  "noci": ["noce", "noci", "walnut", "walnuts"],
  "nocciole": ["nocciola", "nocciole", "hazelnut", "hazelnuts"],
  "pistacchio": ["pistacchio", "pistachio"],
  "mascarpone": ["mascarpone"],
  "ricotta": ["ricotta"],
  "salsiccia": ["salsiccia", "sausage"]
};

const TAXONOMY_CANONICAL: Record<string, string> = {
  "canned-tomatoes": "pomodoro",
  "tomatoes": "pomodoro",
  "tomato": "pomodoro",
  "pasta": "pasta",
  "rice": "riso",
  "milk": "latte",
  "butter": "burro",
  "cream": "panna",
  "cheese": "formaggio",
  "mozzarella": "mozzarella",
  "eggs": "uovo",
  "egg": "uovo",
  "chicken": "pollo",
  "beef": "manzo",
  "tuna": "tonno",
  "salmon": "salmone",
  "olive-oil": "olio",
  "extra-virgin-olive-oil": "olio extravergine",
  "flour": "farina",
  "bread": "pane",
  "sugar": "zucchero",
  "salt": "sale"
};

const ALLERGEN_TO_DIET: Record<string, string[]> = {
  "en:milk": ["contains-dairy"],
  "en:eggs": ["contains-eggs"],
  "en:gluten": ["contains-gluten"],
  "en:wheat": ["contains-gluten"],
  "en:peanuts": ["contains-peanuts"],
  "en:nuts": ["contains-tree-nuts"],
  "en:soybeans": ["contains-soy"],
  "en:fish": ["contains-fish"],
  "en:crustaceans": ["contains-crustaceans"],
  "en:molluscs": ["contains-molluscs"],
  "en:sesame-seeds": ["contains-sesame"],
  "en:mustard": ["contains-mustard"],
  "en:lupin": ["contains-lupin"],
  "en:celery": ["contains-celery"],
  "en:sulphur-dioxide-and-sulphites": ["contains-sulphites"]
};

const norm = (value: string): string =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

const tagName = (value: unknown): string =>
  typeof value === "string" ? value.trim().toLowerCase().replace(/^\w+:/, "").replace(/_/g, "-") : "";

function firstNonEmpty(...values: unknown[]): string | null {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim() ?? null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean))] : [];
}

function inferCanonical(tags: string[], text: string): { name: string | null; confidence: number } {
  const normalizedText = norm(text);
  for (const tag of tags.map(tagName)) {
    const candidate = TAXONOMY_CANONICAL[tag];
    if (candidate) return { name: candidate, confidence: 0.96 };
  }
  for (const [canonical, variants] of Object.entries(ALIAS_GROUPS)) {
    if (variants.some((variant) => normalizedText === norm(variant) || normalizedText.includes(norm(variant)))) {
      return { name: canonical, confidence: 0.90 };
    }
  }
  const fallback = normalizedText.split(" ").filter((token) => token.length > 2).slice(0, 4).join(" ");
  return fallback ? { name: fallback, confidence: 0.55 } : { name: null, confidence: 0 };
}

function baseQuantity(value: number, unit: string): { value: number; unit: "g" | "ml" | "piece" } | null {
  const u = unit.toLowerCase();
  if (u === "kg") return { value: value * 1000, unit: "g" };
  if (u === "g") return { value, unit: "g" };
  if (u === "mg") return { value: value / 1000, unit: "g" };
  if (u === "l") return { value: value * 1000, unit: "ml" };
  if (u === "cl") return { value: value * 10, unit: "ml" };
  if (u === "ml") return { value, unit: "ml" };
  if (["piece", "pieces", "pz", "pcs", "unit", "units"].includes(u)) return { value, unit: "piece" };
  return null;
}

export function deriveProductFoodSemantics(productId: string, raw: Record<string, unknown> | null | undefined, canonicalName?: string | null): ProductFoodSemantics {
  const source = raw ?? {};
  const ingredientTags = stringArray(source.ingredientsTags ?? source.ingredients_tags);
  const categoryTags = stringArray(source.categoriesTags ?? source.categories_tags ?? source.categories_hierarchy);
  const allergenTags = stringArray(source.allergensTags ?? source.allergens_tags).map(tagName);
  const traceTags = stringArray(source.tracesTags ?? source.traces_tags).map(tagName);
  const labelTags = stringArray(source.labelsTags ?? source.labels_tags).map(tagName);
  const productText = firstNonEmpty(
    source.ingredientsTextIt,
    source.ingredients_text_it,
    source.ingredientsText,
    source.ingredients_text,
    canonicalName,
    source.productName,
    source.product_name,
  ) ?? "";

  const canonical = inferCanonical([...ingredientTags, ...categoryTags], productText);
  const aliases = new Set<string>();
  if (canonical.name) {
    aliases.add(norm(canonical.name));
    for (const variant of ALIAS_GROUPS[canonical.name] ?? []) aliases.add(norm(variant));
  }
  for (const value of [...ingredientTags, ...categoryTags]) {
    const clean = tagName(value);
    if (clean) aliases.add(norm(clean.replace(/-/g, " ")));
  }

  const dietary = new Set<string>();
  for (const allergen of allergenTags) for (const flag of ALLERGEN_TO_DIET[allergen] ?? []) dietary.add(flag);
  if (labelTags.some((tag) => /vegan/.test(tag))) dietary.add("vegan");
  if (labelTags.some((tag) => /vegetarian/.test(tag))) dietary.add("vegetarian");
  if (labelTags.some((tag) => /gluten[- ]free/.test(tag))) dietary.add("gluten-free");

  const categoryText = [...categoryTags, productText].join(" ").toLowerCase();
  const culinaryWeight: CulinaryWeight =
    /salt|sale|water|acqua|vinegar|aceto|oil|olio/.test(categoryText) ? "STAPLE" :
    /spice|spezie|herb|erbe|yeast|lievito|garnish|guarn/.test(categoryText) ? "SECONDARY" : "CORE";

  const quantityValue = typeof source.quantityValue === "number"
    ? source.quantityValue
    : typeof source.quantity_value === "number" ? source.quantity_value : null;
  const quantityUnit = firstNonEmpty(source.quantityUnit, source.quantity_unit);
  const normalizedQuantity = quantityValue !== null && quantityUnit ? baseQuantity(quantityValue, quantityUnit) : null;

  return {
    productId,
    canonicalIngredient: canonical.name,
    ingredientTerms: [...aliases],
    taxonomyTags: [...new Set([...ingredientTags, ...categoryTags].map(tagName).filter(Boolean))],
    allergenTags: [...new Set(allergenTags)],
    traceTags: [...new Set(traceTags)],
    labelTags: [...new Set(labelTags)],
    dietaryTags: [...dietary],
    culinaryWeight,
    quantity: quantityValue !== null && quantityUnit ? { value: quantityValue, unit: quantityUnit } : null,
    quantityBase: normalizedQuantity,
    quantityConfidence: normalizedQuantity ? 0.98 : 0,
    semanticConfidence: canonical.confidence,
    source: "derived",
    sourceVersion: "food-semantics-v1",
    observedAt: new Date().toISOString()
  };
}

export function semanticsFromProductSnapshot(productId: string, snapshot: Record<string, unknown> | null | undefined, canonicalName?: string | null): ProductFoodSemantics {
  return deriveProductFoodSemantics(productId, snapshot, canonicalName);
}
