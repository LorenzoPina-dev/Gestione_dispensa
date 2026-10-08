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


export interface FoodQuantity {
  value: number;
  unit: string;
  dimension: "mass" | "volume" | "count";
  baseValue: number;
  baseUnit: "g" | "ml" | "piece";
  sourceRaw: string;
}

const QUANTITY_UNITS: Readonly<Record<string,{dimension:FoodQuantity["dimension"];factor:number;baseUnit:FoodQuantity["baseUnit"]}>> = {
  mg:{dimension:"mass",factor:0.001,baseUnit:"g"}, g:{dimension:"mass",factor:1,baseUnit:"g"}, kg:{dimension:"mass",factor:1000,baseUnit:"g"},
  oz:{dimension:"mass",factor:28.349523125,baseUnit:"g"}, lb:{dimension:"mass",factor:453.59237,baseUnit:"g"},
  ml:{dimension:"volume",factor:1,baseUnit:"ml"}, cl:{dimension:"volume",factor:10,baseUnit:"ml"}, dl:{dimension:"volume",factor:100,baseUnit:"ml"}, l:{dimension:"volume",factor:1000,baseUnit:"ml"},
  tsp:{dimension:"volume",factor:5,baseUnit:"ml"}, teaspoon:{dimension:"volume",factor:5,baseUnit:"ml"}, teaspoons:{dimension:"volume",factor:5,baseUnit:"ml"},
  tbsp:{dimension:"volume",factor:15,baseUnit:"ml"}, tablespoon:{dimension:"volume",factor:15,baseUnit:"ml"}, tablespoons:{dimension:"volume",factor:15,baseUnit:"ml"},
  cup:{dimension:"volume",factor:240,baseUnit:"ml"}, cups:{dimension:"volume",factor:240,baseUnit:"ml"},
  piece:{dimension:"count",factor:1,baseUnit:"piece"}, pieces:{dimension:"count",factor:1,baseUnit:"piece"}, pc:{dimension:"count",factor:1,baseUnit:"piece"},
  pcs:{dimension:"count",factor:1,baseUnit:"piece"}, pz:{dimension:"count",factor:1,baseUnit:"piece"}, pezzo:{dimension:"count",factor:1,baseUnit:"piece"}, pezzi:{dimension:"count",factor:1,baseUnit:"piece"},
  unit:{dimension:"count",factor:1,baseUnit:"piece"}, units:{dimension:"count",factor:1,baseUnit:"piece"}, u:{dimension:"count",factor:1,baseUnit:"piece"}
};

function parseNumericQuantity(value:string):number|null {
  const normalized=value.trim().replace(",", ".");
  const mixed=normalized.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if(mixed){
    const denominator=Number(mixed[3]);
    if(denominator<=0) return null;
    return Number(mixed[1])+Number(mixed[2])/denominator;
  }
  const fraction=normalized.match(/^(\d+)\s*\/\s*(\d+)$/);
  if(fraction){
    const denominator=Number(fraction[2]);
    if(denominator<=0) return null;
    return Number(fraction[1])/denominator;
  }
  const number=Number(normalized);
  return Number.isFinite(number)&&number>0?number:null;
}

export function foodUnitInfo(unit:string): {dimension:FoodQuantity["dimension"];factor:number;baseUnit:FoodQuantity["baseUnit"]}|null {
  return QUANTITY_UNITS[unit.trim().toLowerCase().replace(/\.$/,"")] ?? null;
}

export function foodQuantity(value:number|string, unit:string):FoodQuantity|null {
  const numeric=typeof value==="number"?value:parseNumericQuantity(value);
  const normalizedUnit=unit.trim().toLowerCase().replace(/\.$/,"");
  const info=foodUnitInfo(normalizedUnit);
  if(numeric===null || !info) return null;
  return {value:numeric,unit:normalizedUnit,dimension:info.dimension,baseValue:numeric*info.factor,baseUnit:info.baseUnit,sourceRaw:String(value)+" "+unit.trim()};
}

export function parseFoodQuantityFromText(raw:string):FoodQuantity|null {
  const unitAlternatives="kg|mg|g|lb|oz|dl|cl|ml|l|tbsp\\.?|tsp\\.?|tablespoons?|teaspoons?|cups?|pieces?|pcs?|pc|pz|pezzi?|units?|u";
  const match=raw.trim().match(new RegExp("(?:(\\d+\\s+)?(\\d+\\s*\\/\\s*\\d+)|(\\d+\\s*\\/\\s*\\d+)|(\\d+(?:[.,]\\d+)?))\\s*("+unitAlternatives+")\\b","i"));
  if(!match) return null;
  const valueText=match[1] ? String(match[1]).trim() : match[2] ?? match[3] ?? match[4] ?? "";
  const numeric=parseNumericQuantity(valueText);
  return numeric===null ? null : foodQuantity(numeric,match[5]);
}
