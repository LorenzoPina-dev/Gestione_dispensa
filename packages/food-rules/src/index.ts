export type CulinaryWeight = "STAPLE" | "SECONDARY" | "CORE";

export const ALIAS_GROUPS: Readonly<Record<string, readonly string[]>> = {
  pomodoro: ["pomodoro","pomodori","tomato","tomatoes","tomate","tomates","tomato puree","passata","passata di pomodoro"],
  cipolla: ["cipolla","cipolle","onion","onions"],
  aglio: ["aglio","garlic"],
  patata: ["patata","patate","potato","potatoes"],
  carota: ["carota","carote","carrot","carrots"],
  zucchina: ["zucchina","zucchine","zucchini","courgette","courgettes"],
  melanzana: ["melanzana","melanzane","eggplant","eggplants","aubergine"],
  peperone: ["peperone","peperoni","bell pepper","bell peppers"],
  pollo: ["pollo","chicken"],
  manzo: ["manzo","beef","boeuf"],
  maiale: ["maiale","pork"],
  pancetta: ["pancetta","bacon"],
  prosciutto: ["prosciutto","ham"],
  tonno: ["tonno","tuna"],
  salmone: ["salmone","salmon"],
  uovo: ["uovo","uova","egg","eggs"],
  latte: ["latte","milk"],
  burro: ["burro","butter"],
  panna: ["panna","cream"],
  formaggio: ["formaggio","formaggi","cheese","cheeses"],
  mozzarella: ["mozzarella"],
  parmigiano: ["parmigiano","parmesan"],
  pecorino: ["pecorino","pecorino cheese"],
  farina: ["farina","flour"],
  pane: ["pane","bread"],
  pangrattato: ["pangrattato","breadcrumbs","bread crumbs"],
  pasta: ["pasta","rigatoni","penne","fusilli","farfalle","spaghetti","spaghettini","linguine","bucatini","tagliatelle","fettuccine","maccheroni","maccheroncini","orecchiette","paccheri","cannelloni","lasagne","lasagna"],
  riso: ["riso","rice"],
  ceci: ["cece","ceci","chickpea","chickpeas"],
  fagioli: ["fagiolo","fagioli","bean","beans"],
  piselli: ["pisello","piselli","pea","peas"],
  mais: ["mais","corn"],
  olive: ["oliva","olive","olives"],
  "olio extravergine": ["olio extravergine","olio evo","extra virgin olive oil","extra-virgin olive oil","evo oil"],
  olio: ["olio","oil"],
  sale: ["sale","salt"],
  acqua: ["acqua","water"],
  aceto: ["aceto","vinegar"],
  basilico: ["basilico","basil"],
  prezzemolo: ["prezzemolo","parsley"],
  rosmarino: ["rosmarino","rosemary"],
  limone: ["limone","limoni","lemon","lemons"],
  zucchero: ["zucchero","sugar"],
  cacao: ["cacao","cocoa"],
  cioccolato: ["cioccolato","chocolate"],
  miele: ["miele","honey"],
  mandorle: ["mandorla","mandorle","almond","almonds"],
  noci: ["noce","noci","walnut","walnuts"],
  nocciole: ["nocciola","nocciole","hazelnut","hazelnuts"],
  pistacchio: ["pistacchio","pistachio"],
  mascarpone: ["mascarpone"],
  ricotta: ["ricotta"],
  salsiccia: ["salsiccia","sausage"]
};

export const TAXONOMY_CANONICAL: Readonly<Record<string,string>> = {
  "canned-tomatoes":"pomodoro","tomatoes":"pomodoro","tomato":"pomodoro",
  "pasta":"pasta","rice":"riso","milk":"latte","butter":"burro","cream":"panna",
  "cheese":"formaggio","mozzarella":"mozzarella","eggs":"uovo","egg":"uovo",
  "chicken":"pollo","beef":"manzo","pork":"maiale","tuna":"tonno","salmon":"salmone",
  "olive-oil":"olio","extra-virgin-olive-oil":"olio extravergine","flour":"farina",
  "bread":"pane","sugar":"zucchero","salt":"sale","vinegar":"aceto"
};

export const normalizeFoodText = (value:string):string =>
  value.normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g," ")
    .replace(/\s+/g," ")
    .trim();

export const normalizeFoodTag = (value:string):string =>
  value.trim().toLowerCase().replace(/^\w+:/,"").replace(/_/g,"-");

export function ingredientTerms(value:string):string[] {
  const normalized=normalizeFoodText(value);
  if(!normalized) return [];
  const out=new Set<string>([normalized,...normalized.split(" ").filter(token=>token.length>=3)]);
  for(const [canonical,variants] of Object.entries(ALIAS_GROUPS)){
    const canonicalNorm=normalizeFoodText(canonical);
    const normalizedVariants=variants.map(normalizeFoodText);
    if(normalized===canonicalNorm || normalizedVariants.includes(normalized)){
      out.add(canonicalNorm);
      for(const variant of normalizedVariants) out.add(variant);
    }
  }
  return [...out];
}

export function canonicalizeIngredient(value:string, taxonomyTags:readonly string[]=[]):{
  canonicalIngredient:string|null;
  ingredientTerms:string[];
  confidence:number;
} {
  const text=normalizeFoodText(value);
  for(const rawTag of taxonomyTags){
    const tag=normalizeFoodTag(rawTag);
    const canonical=TAXONOMY_CANONICAL[tag];
    if(canonical){
      return {canonicalIngredient:canonical,ingredientTerms:ingredientTerms(canonical),confidence:0.97};
    }
  }
  for(const [canonical,variants] of Object.entries(ALIAS_GROUPS)){
    const canonicalNorm=normalizeFoodText(canonical);
    if(text===canonicalNorm || variants.some(variant=>{
      const candidate=normalizeFoodText(variant);
      return text===candidate || text.includes(candidate) && candidate.length>=4;
    })){
      return {canonicalIngredient:canonical,ingredientTerms:ingredientTerms(canonical),confidence:0.93};
    }
  }
  if(!text) return {canonicalIngredient:null,ingredientTerms:[],confidence:0};
  const fallback=text.split(" ").filter(token=>token.length>2).slice(0,4).join(" ");
  return {canonicalIngredient:fallback||null,ingredientTerms:ingredientTerms(value),confidence:fallback?0.55:0};
}

const STAPLES=new Set(["sale","acqua","aceto","olio","olio extravergine"]);
const SECONDARY=new Set(["basilico","prezzemolo","rosmarino","zucchero","miele"]);
export function classifyCulinaryWeight(canonicalIngredient:string|null):CulinaryWeight {
  if(canonicalIngredient && STAPLES.has(canonicalIngredient)) return "STAPLE";
  if(canonicalIngredient && SECONDARY.has(canonicalIngredient)) return "SECONDARY";
  return "CORE";
}
