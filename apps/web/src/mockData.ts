import type {
  StockItem, ShoppingList, Recipe, RecipeMatch,
  FamilyMember, Invite, Notification, ConsumedItem, Movement
} from "./types";

export const FAMILY_NAME = "Famiglia Ferretti";

export const members: FamilyMember[] = [
  { id: "u1", name: "Giulia Ferretti", email: "giulia@example.com", avatar: "GF", role: "OWNER", status: "ACTIVE", joinedAt: "2024-01-10" },
  { id: "u2", name: "Marco Ferretti", email: "marco@example.com", avatar: "MF", role: "MANAGER", status: "ACTIVE", joinedAt: "2024-01-10" },
  { id: "u3", name: "Sofia Ferretti", email: "sofia@example.com", avatar: "SF", role: "MEMBER", status: "ACTIVE", joinedAt: "2024-03-15" },
  { id: "u4", name: "Nonno Carlo", email: "carlo@example.com", avatar: "NC", role: "VIEWER", status: "ACTIVE", joinedAt: "2024-06-01" },
];

export const currentUser = members[0];

export const pendingInvite: Invite = {
  inviteId: "inv_x9k2m",
  role: "MEMBER",
  status: "CREATED",
  expiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
  fallbackCode: "847-291",
  createdAt: new Date().toISOString(),
};

const now = new Date();
const d = (daysOffset: number) => {
  const dt = new Date(now);
  dt.setDate(dt.getDate() + daysOffset);
  return dt.toISOString().split("T")[0];
};

export const stockItems: StockItem[] = [
  // FRIGO
  { id: "si1", name: "Latte intero", brand: "Granarolo", batches: [{ quantity: 1, expiryDate: d(3) }], unit: "L", location: "frigo", category: "Latticini", provenance: "VERIFIED", version: 4, calories: 61, protein: 3.2, carbs: 4.8, fat: 3.3, fiber: 0 },
  { id: "si2", name: "Petto di pollo", batches: [{ quantity: 500, expiryDate: d(1) }], unit: "g", location: "frigo", category: "Proteine", provenance: "VERIFIED", version: 2, calories: 165, protein: 31, carbs: 0, fat: 3.6, fiber: 0 },
  { id: "si3", name: "Spinaci freschi", batches: [{ quantity: 200, expiryDate: d(2) }], unit: "g", location: "frigo", category: "Verdure", provenance: "VERIFIED", version: 1, calories: 23, protein: 2.9, carbs: 3.6, fat: 0.4, fiber: 2.2 },
  { id: "si4", name: "Parmigiano Reggiano", brand: "Coop", batches: [{ quantity: 180, expiryDate: d(35) }], unit: "g", location: "frigo", category: "Latticini", provenance: "VERIFIED", version: 3, calories: 392, protein: 33, carbs: 0, fat: 28, fiber: 0 },
  { id: "si5", name: "Uova", batches: [{ quantity: 5, expiryDate: d(12) }], unit: "pz", location: "frigo", category: "Proteine", provenance: "VERIFIED", version: 2, calories: 143, protein: 13, carbs: 1.1, fat: 9.5, fiber: 0 },
  { id: "si6", name: "Yogurt greco", brand: "Fage", batches: [{ quantity: 2, expiryDate: d(-1) }], unit: "vasetto", location: "frigo", category: "Latticini", provenance: "IMPORTED", version: 1, calories: 97, protein: 9, carbs: 3.6, fat: 5, fiber: 0 },
  // FREEZER
  { id: "si7", name: "Branzino", batches: [{ quantity: 400, expiryDate: d(60) }], unit: "g", location: "freezer", category: "Proteine", provenance: "ESTIMATED", version: 1, calories: 97, protein: 18, carbs: 0, fat: 2.5, fiber: 0 },
  { id: "si8", name: "Piselli surgelati", brand: "Findus", batches: [{ quantity: 600, expiryDate: d(180) }], unit: "g", location: "freezer", category: "Verdure", provenance: "VERIFIED", version: 2, calories: 81, protein: 5.4, carbs: 14, fat: 0.4, fiber: 5.5 },
  // DISPENSA SECCA
  { id: "si9", name: "Pasta (rigatoni)", brand: "Barilla", batches: [{ quantity: 500 }], unit: "g", reorderPoint: 200, location: "dispensa", category: "Cereali", provenance: "VERIFIED", version: 5, calories: 352, protein: 12, carbs: 70, fat: 1.5, fiber: 3 },
  { id: "si10", name: "Riso Carnaroli", batches: [{ quantity: 1000 }], unit: "g", location: "dispensa", category: "Cereali", provenance: "VERIFIED", version: 3, calories: 360, protein: 6.7, carbs: 80, fat: 0.7, fiber: 0.4 },
  { id: "si11", name: "Ceci (latta)", batches: [{ quantity: 2 }], unit: "latta", reorderPoint: 1, location: "dispensa", category: "Legumi", provenance: "VERIFIED", version: 2, calories: 164, protein: 8.9, carbs: 27, fat: 2.6, fiber: 7.6 },
  { id: "si12", name: "Olio EVO", brand: "Monini", batches: [{ quantity: 500 }], unit: "ml", reorderPoint: 150, location: "dispensa", category: "Condimenti", provenance: "VERIFIED", version: 6, calories: 884, protein: 0, carbs: 0, fat: 100, fiber: 0 },
  { id: "si13", name: "Pomodori pelati", brand: "Mutti", batches: [{ quantity: 1 }], unit: "latta", location: "dispensa", category: "Conserve", provenance: "VERIFIED", version: 1, calories: 24, protein: 1.5, carbs: 4.6, fat: 0.2, fiber: 1.2 },
  { id: "si14", name: "Farina 00", batches: [{ quantity: 150 }], unit: "g", reorderPoint: 300, location: "dispensa", category: "Cereali", provenance: "VERIFIED", version: 4, calories: 364, protein: 10, carbs: 76, fat: 1, fiber: 2.7 },
  { id: "si15", name: "Aglio", batches: [{ quantity: 1 }], unit: "testa", location: "dispensa", category: "Verdure", provenance: "VERIFIED", version: 2, calories: 149, protein: 6.4, carbs: 33, fat: 0.5, fiber: 2.1 },
  // ALTRO
  { id: "si16", name: "Vino bianco", brand: "Santa Margherita", batches: [{ quantity: 750 }], unit: "ml", location: "altro", category: "Bevande", provenance: "IMPORTED", version: 1 },
];

export const shoppingList: ShoppingList = {
  id: "sl1",
  name: "Spesa settimanale",
  status: "ACTIVE",
  version: 12,
  lastEditedBy: "Marco Ferretti",
  lastEditedAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
  items: [
    { id: "sli1", displayName: "Farina 00", quantity: 1, unit: "kg", state: "ACCEPTED", sourceType: "REORDER", sourceRef: "si14", version: 2, addedBy: "Sistema", addedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() },
    { id: "sli2", displayName: "Mozzarella di bufala", quantity: 2, unit: "pz", state: "ACCEPTED", sourceType: "MANUAL", version: 1, addedBy: "Marco Ferretti", addedAt: new Date(Date.now() - 25 * 60 * 1000).toISOString() },
    { id: "sli3", displayName: "Pomodori ciliegini", quantity: 500, unit: "g", state: "SUGGESTED", sourceType: "RECIPE", sourceRef: "r2", version: 1, addedBy: "Sistema", addedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() },
    { id: "sli4", displayName: "Pane di segale", quantity: 1, unit: "pagnotta", state: "ACCEPTED", sourceType: "MANUAL", version: 1, addedBy: "Giulia Ferretti", addedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString() },
    { id: "sli5", displayName: "Olio EVO", quantity: 1, unit: "bottiglia", state: "SUGGESTED", sourceType: "REORDER", sourceRef: "si12", version: 1, addedBy: "Sistema", addedAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString() },
    { id: "sli6", displayName: "Limoni", quantity: 4, unit: "pz", state: "ACCEPTED", sourceType: "MANUAL", version: 2, addedBy: "Sofia Ferretti", addedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() },
    { id: "sli7", displayName: "Basilico fresco", quantity: 1, unit: "mazzo", state: "SUGGESTED", sourceType: "OFFER", version: 1, addedBy: "Sistema", addedAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString() },
  ],
};

export const recipes: Recipe[] = [
  {
    id: "r1", title: "Pasta al pomodoro", source: "Ricettario Ferretti", quality: "VERIFIED",
    servings: 4, time: 25, difficulty: "Facile",
    ingredients: [
      { name: "Pasta", stockItemId: "si9", amount: 320, unit: "g", allergens: ["glutine"] },
      { name: "Pomodori pelati", stockItemId: "si13", amount: 1, unit: "latta", allergens: [] },
      { name: "Aglio", stockItemId: "si15", amount: 2, unit: "spicchi", allergens: [] },
      { name: "Olio EVO", stockItemId: "si12", amount: 30, unit: "ml", allergens: [] },
      { name: "Parmigiano", stockItemId: "si4", amount: 40, unit: "g", allergens: ["latte"] },
    ],
    steps: ["Porta a bollore l'acqua salata.", "Fai soffriggere l'aglio in olio per 2 min.", "Aggiungi i pelati e cuoci 15 min a fuoco medio.", "Scola la pasta al dente e manteca col sugo.", "Servi con parmigiano grattugiato."],
    image: "photo-1621996346565-e3dbc646d9a9", tags: ["vegetariano", "primo"], caloriesPerServing: 480,
  },
  {
    id: "r2", title: "Frittata di spinaci", source: "Cucina italiana", quality: "IMPORTED",
    servings: 2, time: 15, difficulty: "Facile",
    ingredients: [
      { name: "Uova", stockItemId: "si5", amount: 4, unit: "pz", allergens: ["uova"] },
      { name: "Spinaci", stockItemId: "si3", amount: 150, unit: "g", allergens: [] },
      { name: "Parmigiano", stockItemId: "si4", amount: 30, unit: "g", allergens: ["latte"] },
      { name: "Pomodori ciliegini", amount: 100, unit: "g", allergens: [] },
    ],
    steps: ["Sbollenta gli spinaci, strizzali.", "Sbatti uova con parmigiano, sale e pepe.", "Aggiungi gli spinaci al composto.", "Cuoci in padella 4 min per lato."],
    image: "photo-1565958011703-44f9829ba187", tags: ["vegetariano", "secondo"], caloriesPerServing: 310,
  },
  {
    id: "r3", title: "Risotto al parmigiano", source: "Ricettario Ferretti", quality: "VERIFIED",
    servings: 4, time: 40, difficulty: "Medio",
    ingredients: [
      { name: "Riso Carnaroli", stockItemId: "si10", amount: 320, unit: "g", allergens: [] },
      { name: "Parmigiano", stockItemId: "si4", amount: 80, unit: "g", allergens: ["latte"] },
      { name: "Olio EVO", stockItemId: "si12", amount: 20, unit: "ml", allergens: [] },
      { name: "Vino bianco", stockItemId: "si16", amount: 100, unit: "ml", allergens: ["solfiti"] },
    ],
    steps: ["Tosta il riso in olio per 2 min.", "Sfuma col vino e lascia evaporare.", "Aggiungi brodo caldo un mestolo alla volta.", "Manteca fuori dal fuoco con parmigiano e un filo d'olio."],
    image: "photo-1476124369491-e7addf5db371", tags: ["vegetariano", "primo"], caloriesPerServing: 560,
  },
  {
    id: "r4", title: "Pollo con piselli", source: "Cucina italiana", quality: "ESTIMATED",
    servings: 3, time: 35, difficulty: "Facile",
    ingredients: [
      { name: "Petto di pollo", stockItemId: "si2", amount: 400, unit: "g", allergens: [] },
      { name: "Piselli surgelati", stockItemId: "si8", amount: 300, unit: "g", allergens: [] },
      { name: "Olio EVO", stockItemId: "si12", amount: 25, unit: "ml", allergens: [] },
      { name: "Aglio", stockItemId: "si15", amount: 1, unit: "spicchio", allergens: [] },
      { name: "Pomodori pelati", stockItemId: "si13", amount: 200, unit: "g", allergens: [] },
    ],
    steps: ["Rosola il pollo in olio con l'aglio fino a doratura.", "Aggiungi i pelati e i piselli.", "Cuoci coperto 20 min a fuoco medio-basso.", "Aggiusta di sale e servi caldo."],
    image: "photo-1604908176997-125f25cc6f3d", tags: ["proteico", "secondo"], caloriesPerServing: 390,
  },
  {
    id: "r5", title: "Zuppa di ceci", source: "Cucina italiana", quality: "IMPORTED",
    servings: 3, time: 35, difficulty: "Facile",
    ingredients: [
      { name: "Ceci", stockItemId: "si11", amount: 1, unit: "latta", allergens: [] },
      { name: "Aglio", stockItemId: "si15", amount: 2, unit: "spicchi", allergens: [] },
      { name: "Olio EVO", stockItemId: "si12", amount: 30, unit: "ml", allergens: [] },
      { name: "Pomodori pelati", stockItemId: "si13", amount: 200, unit: "g", allergens: [] },
      { name: "Pasta", stockItemId: "si9", amount: 120, unit: "g", allergens: ["glutine"] },
    ],
    steps: ["Soffriggi aglio in olio.", "Aggiungi ceci scolati e pelati, copri con brodo.", "Cuoci 15 min, frulla metà.", "Aggiungi la pasta e cuoci al dente."],
    image: "photo-1547592180-85f173990554", tags: ["vegano", "primo"], caloriesPerServing: 280,
  },
];

export function computeRecipeMatches(stock: StockItem[]): RecipeMatch[] {
  const stockIds = new Set(stock.map((s) => s.id));
  return recipes
    .map((recipe) => {
      const matched = recipe.ingredients.filter((i) => i.stockItemId && stockIds.has(i.stockItemId)).map((i) => i.name);
      const missing = recipe.ingredients.filter((i) => !i.stockItemId || !stockIds.has(i.stockItemId)).map((i) => i.name);
      const score = matched.length / recipe.ingredients.length;
      return { recipe, score, matchedIngredients: matched, missingIngredients: missing };
    })
    .sort((a, b) => b.score - a.score);
}

export const recentConsumed: ConsumedItem[] = [
  { id: "c1", name: "Pasta al pomodoro", quantity: 320, unit: "g", nutrients: { calories: 480, protein: 16, carbs: 85, fat: 8, fiber: 4, confidence: "CONFIRMED" }, at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() },
  { id: "c2", name: "Yogurt greco", quantity: 125, unit: "g", nutrients: { calories: 121, protein: 11.25, carbs: 4.5, fat: 6.25, fiber: 0, confidence: "ESTIMATED" }, at: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString() },
  { id: "c3", name: "Uova strapazzate", quantity: 2, unit: "pz", nutrients: { calories: 143, protein: 13, carbs: 1.1, fat: 9.5, fiber: 0, confidence: "CONFIRMED" }, at: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString() },
  { id: "c4", name: "Branzino al vapore", quantity: 200, unit: "g", nutrients: { calories: 194, protein: 36, carbs: 0, fat: 5, fiber: 0, confidence: "ESTIMATED" }, at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString() },
];

export const movements: Movement[] = [
  { id: "m1", stockItemId: "si9", type: "RECEIPT", quantity: 500, unit: "g", by: "Giulia Ferretti", at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString() },
  { id: "m2", stockItemId: "si9", type: "CONSUMPTION", quantity: 320, unit: "g", note: "Pasta al pomodoro", by: "Marco Ferretti", at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() },
  { id: "m3", stockItemId: "si6", type: "CONSUMPTION", quantity: 1, unit: "vasetto", note: "Colazione", by: "Sofia Ferretti", at: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString() },
  { id: "m4", stockItemId: "si14", type: "CONSUMPTION", quantity: 150, unit: "g", note: "Biscotti", by: "Giulia Ferretti", at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() },
];

export const notifications: Notification[] = [
  { id: "n1", category: "REORDER", title: "Scorte basse: Farina 00", body: "Hai solo 150 g di farina. Soglia minima: 300 g. Aggiunta alla lista della spesa.", createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() },
  { id: "n2", category: "REORDER", title: "Scorte basse: Olio EVO", body: "Hai 500 ml di olio. Soglia minima: 150 ml. Aggiunta alla lista della spesa.", createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(), readAt: new Date().toISOString() },
  { id: "n3", category: "INVITE", title: "Invito inviato", body: "Hai invitato un nuovo membro come Membro. Il codice scade tra 2 giorni.", createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString() },
  { id: "n4", category: "SYSTEM", title: "Lista spesa condivisa", body: "Marco Ferretti ha condiviso la lista «Spesa settimanale» con tutta la famiglia.", createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), readAt: new Date().toISOString() },
];
