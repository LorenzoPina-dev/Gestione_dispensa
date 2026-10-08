export type CulinaryWeight = "STAPLE" | "SECONDARY" | "CORE";

export const ALIAS_GROUPS: Readonly<Record<string, readonly string[]>> = {
  pomodoro: ["pomodoro","pomodori","tomato","tomatoes","tomate","tomates","tomato puree","passata","passata di pomodoro","tomate frito"],
  cipolla: ["cipolla","cipolle","onion","onions","oignon","oignons","cebolla","cebollas","zwiebel"],
  aglio: ["aglio","garlic","ail","ajo","knoblauch"],
  patata: ["patata","patate","potato","potatoes","pomme de terre","pommes de terre","patatas","kartoffel","kartoffeln"],
  carota: ["carota","carote","carrot","carrots","carotte","carottes","zanahoria","karotte","karotten"],
  zucchina: ["zucchina","zucchine","zucchini","courgette","courgettes","calabacin","calabacines"],
  melanzana: ["melanzana","melanzane","eggplant","eggplants","aubergine","aubergines","berenjena","berenjenas"],
  peperone: ["peperone","peperoni","bell pepper","bell peppers","poivron","poivrons","pimiento","pimientos"],
  pollo: ["pollo","chicken","poulet","hähnchen","huhn"],
  manzo: ["manzo","beef","boeuf","bœuf","rindfleisch"],
  maiale: ["maiale","pork","porc","cerdo","schweinefleisch"],
  pancetta: ["pancetta","bacon"],
  prosciutto: ["prosciutto","ham"],
  tonno: ["tonno","tuna","thon","atún"],
  salmone: ["salmone","salmon","saumon","salmón","lachs"],
  uovo: ["uovo","uova","egg","eggs","œuf","oeuf","oeufs","huevo","huevos","ei","eier"],
  latte: ["latte","milk","lait","leche","milch"],
  burro: ["burro","butter","beurre","mantequilla"],
  panna: ["panna","cream","crème","creme","nata","sahne"],
  formaggio: ["formaggio","formaggi","cheese","cheeses","fromage","fromages","queso","quesos","käse"],
  mozzarella: ["mozzarella"],
  parmigiano: ["parmigiano","parmesan"],
  pecorino: ["pecorino","pecorino cheese"],
  fiordilatte: ["fiordilatte","fior di latte"],
  pesto: ["pesto","pesto genovese","genovese pesto"],
  yogurt: ["yogurt","yoghurt","yaourt","yogur","joghurt"],
  tofu: ["tofu"],
  seitan: ["seitan"],
  brodo: ["brodo","broth","bouillon"],
  ragu: ["ragù","ragu","ragout"],
  farina: ["farina","flour","farine","harina","mehl"],
  pane: ["pane","bread","pain","pan","brot"],
  pangrattato: ["pangrattato","breadcrumbs","bread crumbs","chapelure","pan rallado"],
  pasta: ["pasta","rigatoni","penne","fusilli","farfalle","spaghetti","spaghettini","linguine","bucatini","tagliatelle","fettuccine","maccheroni","maccheroncini","orecchiette","paccheri","cannelloni","lasagne","lasagna"],
  riso: ["riso","rice","riz","arroz","reis"],
  ceci: ["cece","ceci","chickpea","chickpeas","pois chiches","garbanzos","kichererbsen"],
  fagioli: ["fagiolo","fagioli","bean","beans","haricot","haricots","frijol","frijoles","bohne","bohnen"],
  piselli: ["pisello","piselli","pea","peas","petit pois","petits pois","guisante","guisantes","erbse","erbsen"],
  mais: ["mais","corn"],
  olive: ["oliva","olive","olives"],
  "olio extravergine": ["olio extravergine","olio evo","extra virgin olive oil","extra-virgin olive oil","evo oil"],
  olio: ["olio","oil"],
  sale: ["sale","salt","sel","sal","salz"],
  acqua: ["acqua","water","eau","agua","wasser"],
  aceto: ["aceto","vinegar","vinaigre","vinagre","essig"],
  basilico: ["basilico","basil","basilic","albahaca"],
  prezzemolo: ["prezzemolo","parsley","persil","perejil"],
  rosmarino: ["rosmarino","rosemary","romarin","romero"],
  limone: ["limone","limoni","lemon","lemons","citron","citrons","limón","zitrone"],
  zucchero: ["zucchero","sugar","sucre","azúcar","zucker"],
  cacao: ["cacao","cocoa"],
  cioccolato: ["cioccolato","chocolate"],
  miele: ["miele","honey","miel","honig"],
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
  status:SemanticStatus;
} {
  const text=normalizeFoodText(value);
  const hasPhrase=(candidate:string):boolean=>{
    const normalized=normalizeFoodText(candidate);
    return normalized.length>=4 && (" "+text+" ").includes(" "+normalized+" ");
  };
  for(const rawTag of taxonomyTags){
    const tag=normalizeFoodTag(rawTag);
    const canonical=TAXONOMY_CANONICAL[tag];
    if(canonical){
      return {canonicalIngredient:canonical,ingredientTerms:ingredientTerms(canonical),confidence:0.97,status:"EXACT"};
    }
  }
  for(const [canonical,variants] of Object.entries(ALIAS_GROUPS)){
    const canonicalNorm=normalizeFoodText(canonical);
    if(text===canonicalNorm || variants.some(variant=>text===normalizeFoodText(variant) || hasPhrase(variant))){
      return {canonicalIngredient:canonical,ingredientTerms:ingredientTerms(canonical),confidence:0.93,status:"EXACT"};
    }
  }
  if(!text) return {canonicalIngredient:null,ingredientTerms:[],confidence:0,status:"UNKNOWN"};
  const fallback=text.split(" ").filter(token=>token.length>2).slice(0,4).join(" ");
  return {canonicalIngredient:fallback||null,ingredientTerms:ingredientTerms(value),confidence:fallback?0.55:0,status:fallback?"AMBIGUOUS":"UNKNOWN"};
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


export type SemanticStatus = "EXACT" | "INFERRED" | "UNKNOWN" | "AMBIGUOUS";
export type SemanticRelation = "EXACT" | "SYNONYM" | "RECIPE_GENERALIZES_PRODUCT" | "UNSAFE_GENERALIZATION" | "NONE";

const FOOD_PARENT: Readonly<Record<string,string>> = {
  rigatoni:"pasta",penne:"pasta",fusilli:"pasta",farfalle:"pasta",spaghetti:"pasta",
  spaghettini:"pasta",linguine:"pasta",bucatini:"pasta",tagliatelle:"pasta",
  fettuccine:"pasta",maccheroni:"pasta",maccheroncini:"pasta",orecchiette:"pasta",
  paccheri:"pasta",cannelloni:"pasta",lasagne:"pasta",lasagna:"pasta",
  mozzarella:"formaggio",parmigiano:"formaggio",pecorino:"formaggio",fiordilatte:"formaggio",
  mascarpone:"formaggio",ricotta:"formaggio",
  mandorle:"frutta secca",noci:"frutta secca",nocciole:"frutta secca",pistacchio:"frutta secca",
  ceci:"legumi",fagioli:"legumi",piselli:"legumi",
  pollo:"carne",manzo:"carne",maiale:"carne",pancetta:"carne",prosciutto:"carne",salsiccia:"carne",
  tonno:"pesce",salmone:"pesce",
  pomodoro:"ortaggi",cipolla:"ortaggi",aglio:"ortaggi",patata:"ortaggi",carota:"ortaggi",
  zucchina:"ortaggi",melanzana:"ortaggi",peperone:"ortaggi",
};

const SAFE_GENERIC_RECIPE_PARENTS = new Set([
  "pasta","formaggio","frutta secca","legumi","carne","pesce","ortaggi"
]);

export function foodSemanticRelation(recipeCanonical:string|null, productCanonical:string|null):SemanticRelation {
  if(!recipeCanonical||!productCanonical)return "NONE";
  const recipe=normalizeFoodText(recipeCanonical);
  const product=normalizeFoodText(productCanonical);
  if(recipe===product)return "EXACT";
  if(FOOD_PARENT[product]===recipe && SAFE_GENERIC_RECIPE_PARENTS.has(recipe))return "RECIPE_GENERALIZES_PRODUCT";
  const recipeParent=FOOD_PARENT[recipe];
  if(recipeParent===product)return "UNSAFE_GENERALIZATION";
  return "NONE";
}

export interface FunctionalSubstitution {
  fromCanonical:string;
  toCanonical:string;
  factor:number;
  reason:string;
}

export const FUNCTIONAL_SUBSTITUTIONS:readonly FunctionalSubstitution[] = [
  {fromCanonical:"parmigiano",toCanonical:"pecorino",factor:0.8,reason:"Hard aged sheep cheese can fulfill the grating/savoury-cheese function."},
  {fromCanonical:"pecorino",toCanonical:"parmigiano",factor:0.8,reason:"Hard aged grating cheese can fulfill the same savoury-cheese function."},
  {fromCanonical:"mozzarella",toCanonical:"fiordilatte",factor:0.8,reason:"Fiordilatte is a direct fresh-milk-cheese functional substitute for mozzarella."},
  {fromCanonical:"fiordilatte",toCanonical:"mozzarella",factor:0.8,reason:"Mozzarella is a direct fresh-cheese functional substitute for fiordilatte."}
];

export function functionalSubstitution(target:string|null,candidate:string|null):FunctionalSubstitution|null {
  if(!target||!candidate)return null;
  const from=normalizeFoodText(target);
  const to=normalizeFoodText(candidate);
  return FUNCTIONAL_SUBSTITUTIONS.find(rule=>normalizeFoodText(rule.fromCanonical)===from&&normalizeFoodText(rule.toCanonical)===to)??null;
}

export interface FoodComponent {
  raw:string;
  canonicalIngredient:string|null;
  ingredientTerms:string[];
  percentage:number|null;
  confidence:number;
}

function splitIngredientSegments(raw:string):string[] {
  const result:string[]=[]; let buffer=""; let depth=0;
  for(const char of raw){
    if(char==="("||char==="["||char==="{") depth++;
    if(char===")"||char==="]"||char==="}") depth=Math.max(0,depth-1);
    if(depth===0&&(char===","||char===";")){
      if(buffer.trim()) result.push(buffer.trim());
      buffer="";
    } else buffer+=char;
  }
  if(buffer.trim()) result.push(buffer.trim());
  return result;
}

export function parseIngredientText(raw:string,limit=64):FoodComponent[] {
  const text=raw.trim();
  if(!text)return [];
  const segments=splitIngredientSegments(text);
  const components:FoodComponent[]=[];
  for(const segment of segments.slice(0,limit)){
    const cleaned=segment.replace(/^ingredients?\s*:\s*/i,"").replace(/^ingredients?\s*[-–]\s*/i,"").replace(/^[-*•]+\s*/,"").trim();
    if(!cleaned)continue;
    const percentageMatch=cleaned.match(/(?:^|\s)(\d+(?:[.,]\d+)?)\s*%/);
    const percentage=percentageMatch?Number(percentageMatch[1].replace(",", ".")):null;
    const name=cleaned.replace(/(?:^|\s)\d+(?:[.,]\d+)?\s*%/g," ").replace(/\s+/g," ").trim();
    const canonical=canonicalizeIngredient(name);
    components.push({
      raw:name,
      canonicalIngredient:canonical.confidence >= 0.8 ? canonical.canonicalIngredient : null,
      ingredientTerms:canonical.ingredientTerms,
      percentage:Number.isFinite(percentage??0)?percentage:null,
      confidence:canonical.confidence,
    });
  }
  return components;
}

export type AllergenCode =
  | "milk" | "eggs" | "gluten" | "wheat" | "peanuts" | "nuts"
  | "soybeans" | "fish" | "crustaceans" | "molluscs" | "sesame-seeds"
  | "mustard" | "lupin" | "celery" | "sulphites";

const INGREDIENT_ALLERGENS: Readonly<Record<string, readonly AllergenCode[]>> = {
  latte:["milk"], burro:["milk"], panna:["milk"], formaggio:["milk"], mozzarella:["milk"],
  parmigiano:["milk"], pecorino:["milk"], mascarpone:["milk"], ricotta:["milk"],
  uovo:["eggs"], farina:["gluten","wheat"], pane:["gluten","wheat"], pangrattato:["gluten","wheat"],
  pasta:["gluten","wheat"], couscous:["gluten","wheat"],
  mandorle:["nuts"], noci:["nuts"], nocciole:["nuts"], pistacchio:["nuts"],
  arachidi:["peanuts"], soia:["soybeans"], tonno:["fish"], salmone:["fish"],
  pesce:["fish"], gamberi:["crustaceans"], crostacei:["crustaceans"],
  molluschi:["molluscs"], sesamo:["sesame-seeds"], senape:["mustard"], sedano:["celery"],
};

export function canonicalAllergenTag(value:string):AllergenCode|null {
  const stripped=value.trim().replace(/^([a-z]{2}):/i,"");
  const normalized=normalizeFoodText(stripped).replace(/ /g,"-");
  const aliases:Readonly<Record<string,AllergenCode>>={
    milk:"milk",latte:"milk",dairy:"milk",
    eggs:"eggs",egg:"eggs",uovo:"eggs",uova:"eggs",
    gluten:"gluten",wheat:"wheat",grano:"wheat",frumento:"wheat",
    peanuts:"peanuts",peanut:"peanuts",arachidi:"peanuts",
    nuts:"nuts","tree-nuts":"nuts","frutta-secca":"nuts",
    soy:"soybeans",soya:"soybeans",soybeans:"soybeans",
    fish:"fish",pesce:"fish",
    crustaceans:"crustaceans",crustacei:"crustaceans",shellfish:"crustaceans",
    molluscs:"molluscs",mollusks:"molluscs",molluschi:"molluscs",
    sesame:"sesame-seeds","sesame-seeds":"sesame-seeds",sesamo:"sesame-seeds",
    mustard:"mustard",senape:"mustard",lupin:"lupin",lupino:"lupin",
    celery:"celery",sedano:"celery",sulphites:"sulphites",sulfites:"sulphites",solfiti:"sulphites"
  };
  return aliases[normalized] ?? null;
}

export function inferIngredientAllergens(canonicalIngredient:string|null, terms:readonly string[]=[]):AllergenCode[] {
  const values=new Set<AllergenCode>();
  if(canonicalIngredient){
    for(const code of INGREDIENT_ALLERGENS[normalizeFoodText(canonicalIngredient)] ?? []) values.add(code);
  }
  for(const term of terms){
    const canonical=canonicalizeIngredient(term).canonicalIngredient;
    for(const code of INGREDIENT_ALLERGENS[normalizeFoodText(canonical ?? "")] ?? []) values.add(code);
  }
  return [...values];
}
