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
  pepe: ["pepe","pepe nero","pepe bianco","black pepper","white pepper","poivre","pimienta","pfeffer"],
  peperoncino: ["peperoncino","peperoncini","chili","chilli","chili pepper","poivre rouge","guindilla"],
  salvia: ["salvia","sage","sauge","salvia"],
  timo: ["timo","thyme","thym","tomillo"],
  origano: ["origano","oregano","origan","orégano"],
  curry: ["curry"],
  paprika: ["paprika","paprica"],
  "noce moscata": ["noce moscata","nutmeg","muscade","nuez moscada"],
  cannella: ["cannella","cinnamon","cannelle","canela"],
  curcuma: ["curcuma","turmeric","curcuma","cúrcuma"],
  zafferano: ["zafferano","saffron","safran","azafrán"],
  capperi: ["cappero","capperi","caper","capers","câpre","alcaparra"],
  acciuga: ["acciuga","acciughe","anchovy","anchovies","anchois","anchoa"],
  gambero: ["gambero","gamberi","shrimp","prawn","prawns","crevette","crevettes","gamba"],
  cozza: ["cozza","cozze","mussel","mussels","moule","moules","mejillón","mejillones"],
  vongola: ["vongola","vongole","clam","clams","palourde","palourdes","almeja","almejas"],
  calamaro: ["calamaro","calamari","squid","calmar","calamares"],
  lenticchia: ["lenticchia","lenticchie","lentil","lentils","lentille","lentilles","lenteja","lentejas"],
  polenta: ["polenta","cornmeal","farina di mais","semoule de maïs","harina de maíz"],
  semola: ["semola","semolina","semoule","sémolina","sémola"],
  "amido di mais": ["amido di mais","maizena","cornstarch","corn starch","fécule de maïs","almidón de maíz"],
  "lievito per dolci": ["lievito per dolci","baking powder","levure chimique","levadura química","backpulver"],
  lievito: ["lievito","yeast","levure","levadura","hefe"],
  gelatina: ["gelatina","gelatine","gelatin","gélatine","gelatina"],
  gorgonzola: ["gorgonzola"],
  taleggio: ["taleggio"],
  mortadella: ["mortadella"],

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
  salsiccia: ["salsiccia","sausage"],
  mayonnaise: ["mayonnaise","maionese","mayonesa","mayonnaise sauce"],
  ketchup: ["ketchup","catsup"],
  senape: ["senape","mustard","moutarde","mostaza","senf"],
  marmellata: ["marmellata","jam","jelly","confiture","mermelada","marmelade"],
  biscotti: ["biscotto","biscotti","biscuit","biscuits","cookie","cookies","galleta","galletas","keks"],
  cracker: ["cracker","crackers"],

  salame: ["salame","salami","salami sausage"],
  legumi: ["legume","legumi","pulses","legumes","legumes alimentaires"],
  carne: ["carne","meat","viande","carne"],
  pesce: ["pesce","fish","poisson","pescado","fisch"],
  ortaggi: ["ortaggio","ortaggi","vegetable","vegetables","légume","legumbres","gemüse"]
};

export const TAXONOMY_CANONICAL: Readonly<Record<string,string>> = {
  "canned-tomatoes":"pomodoro","tomatoes":"pomodoro","tomato":"pomodoro",
  "pasta":"pasta","rice":"riso","milk":"latte","butter":"burro","cream":"panna",
  "cheese":"formaggio","mozzarella":"mozzarella","eggs":"uovo","egg":"uovo",
  "chicken":"pollo","beef":"manzo","pork":"maiale","tuna":"tonno","salmon":"salmone",
  "olive-oil":"olio","extra-virgin-olive-oil":"olio extravergine","flour":"farina",
  "bread":"pane","sugar":"zucchero","salt":"sale","vinegar":"aceto","pepper":"pepe","black-pepper":"pepe","chili-pepper":"peperoncino","sage":"salvia","thyme":"timo","oregano":"origano","curry":"curry","paprika":"paprika","nutmeg":"noce moscata","cinnamon":"cannella","turmeric":"curcuma","saffron":"zafferano","caper":"capperi","anchovy":"acciuga","shrimp":"gambero","mussels":"cozza","mussel":"cozza","clams":"vongola","clam":"vongola","squid":"calamaro","lentils":"lenticchia","polenta":"polenta","semolina":"semola","corn-starch":"amido di mais","baking-powder":"lievito per dolci","yeast":"lievito","gelatin":"gelatina","gorgonzola":"gorgonzola","taleggio":"taleggio"
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

const STAPLES=new Set(["sale","acqua","aceto","olio","olio extravergine","pepe"]);
const SECONDARY=new Set(["basilico","prezzemolo","rosmarino","salvia","timo","origano","peperoncino","curry","paprika","noce moscata","cannella","curcuma","zafferano","capperi","lievito","lievito per dolci","zucchero","miele","gelatina"]);
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
  tsp:{dimension:"volume",factor:5,baseUnit:"ml"}, teaspoon:{dimension:"volume",factor:5,baseUnit:"ml"}, teaspoons:{dimension:"volume",factor:5,baseUnit:"ml"}, cucchiaino:{dimension:"volume",factor:5,baseUnit:"ml"}, cucchiaini:{dimension:"volume",factor:5,baseUnit:"ml"},
  tbsp:{dimension:"volume",factor:15,baseUnit:"ml"}, tablespoon:{dimension:"volume",factor:15,baseUnit:"ml"}, tablespoons:{dimension:"volume",factor:15,baseUnit:"ml"}, cucchiaio:{dimension:"volume",factor:15,baseUnit:"ml"}, cucchiai:{dimension:"volume",factor:15,baseUnit:"ml"},
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

const COUNTABLE_INGREDIENTS = new Set([
  "uovo","cipolla","aglio","patata","carota","zucchina","melanzana","peperone",
  "limone","pomodoro","pollo","salsiccia","pane","mozzarella","formaggio"
]);

export function parseFoodCountFromText(raw:string,canonicalIngredient:string|null):FoodQuantity|null {
  if(!canonicalIngredient||!COUNTABLE_INGREDIENTS.has(normalizeFoodText(canonicalIngredient)))return null;
  const match=raw.trim().match(/^(?:\s*)(\d+(?:[.,]\d+)?)\s+.+$/i);
  if(!match)return null;
  return foodQuantity(match[1],"piece");
}

export function foodQuantity(value:number|string, unit:string):FoodQuantity|null {
  const numeric=typeof value==="number"?value:parseNumericQuantity(value);
  const normalizedUnit=unit.trim().toLowerCase().replace(/\.$/,"");
  const info=foodUnitInfo(normalizedUnit);
  if(numeric===null || !info) return null;
  return {value:numeric,unit:normalizedUnit,dimension:info.dimension,baseValue:numeric*info.factor,baseUnit:info.baseUnit,sourceRaw:String(value)+" "+unit.trim()};
}

export function parseFoodQuantityFromText(raw:string):FoodQuantity|null {
  const compact=raw.trim();
  const multiPack=compact.match(/(?:^|\\b)(\\d+(?:[.,]\\d+)?)\\s*[x×]\\s*(\\d+(?:[.,]\\d+)?)\\s*(kg|mg|g|lb|oz|dl|cl|ml|l|tbsp\\.?|tsp\\.?|tablespoons?|teaspoons?|cups?|pieces?|pcs?|pc|pz|pezzi?|units?|u)\\b/i);
  if(multiPack){
    const packs=parseNumericQuantity(multiPack[1]!);
    const each=parseNumericQuantity(multiPack[2]!);
    if(packs!==null && each!==null){
      const parsed=foodQuantity(packs*each,multiPack[3]!);
      if(parsed) return {...parsed,sourceRaw:compact};
    }
  }
  if(/\b\d+(?:[.,]\d+)?\s*[-–—]\s*\d+(?:[.,]\d+)?\s*(?:kg|mg|g|lb|oz|dl|cl|ml|l|tbsp\.?|tsp\.?|tablespoons?|teaspoons?|cups?|pieces?|pcs?|pc|pz|pezzi?|units?|u)\b/i.test(raw)) return null;
  if(/\b\d+(?:[.,]\d+)?\s*(?:to|a)\s*\d+(?:[.,]\d+)?\s*(?:kg|mg|g|lb|oz|dl|cl|ml|l|tbsp\.?|tsp\.?|tablespoons?|teaspoons?|cups?|pieces?|pcs?|pc|pz|pezzi?|units?|u)\b/i.test(raw)) return null;
  const unitAlternatives="kg|mg|g|lb|oz|dl|cl|ml|l|tbsp\\.?|tsp\\.?|tablespoons?|teaspoons?|cups?|pieces?|pcs?|pc|pz|pezzi?|units?|u";
  const match=raw.trim().match(new RegExp("(?:(\\d+\\s+)?(\\d+\\s*\\/\\s*\\d+)|(\\d+\\s*\\/\\s*\\d+)|(\\d+(?:[.,]\\d+)?))\\s*("+unitAlternatives+")\\b","i"));
  if(!match) return null;
  const valueText=match[1] ? String(match[1]).trim() : match[2] ?? match[3] ?? match[4] ?? "";
  const numeric=parseNumericQuantity(valueText);
  return numeric===null ? null : foodQuantity(numeric,match[5]);
}


export interface ParsedFoodIngredientLine {
  raw:string;
  ingredientText:string;
  quantity:FoodQuantity|null;
  quantityConfidence:number;
  prepState:string|null;
}

const PREPARATION_PATTERNS:readonly RegExp[] = [
  /\b(?:beaten|whisked|separated|chopped|diced|minced|sliced|grated|peeled|crushed|melted|softened|drained|rinsed|cooked|boiled|roasted|dried|finely|roughly|thinly)\b/gi,
  /\b(?:sbattut[oaie]?|montat[oaie]?|separat[oaie]?|tritat[oaie]?|tagliat[oaie]?|affettat[oaie]?|grattugiat[oaie]?|pelat[oaie]?|schiacciat[oaie]?|fuso|fusa|ammorbidit[oaie]?|scolat[oaie]?|sciacquat[oaie]?|cotto|cotta|lessat[oaie]?|arrostit[oaie]?|finemente|grossolanamente)\b/gi,
  /\b(?:haché|hachée|émincé|émincée|tranché|tranchée|râpé|râpée|pelé|pelée|écrasé|écrasée|fondu|fondue|égoutté|égouttée|cuit|cuite|finement)\b/gi,
  /\b(?:batid[oa]s?|picad[oa]s?|trocead[oa]s?|cortad[oa]s?|rallad[oa]s?|pelad[oa]s?|machacad[oa]s?|derretid[oa]s?|escurrid[oa]s?|cocid[oa]s?|finamente)\b/gi,
  /\b(?:gehackt|gewürfelt|geschnitten|gerieben|geschält|zerdrückt|geschmolzen|abgetropft|gekocht|fein)\b/gi,
];

function detectPreparationState(raw:string):string|null {
  for(const pattern of PREPARATION_PATTERNS){
    const match=raw.match(pattern);
    if(match?.[0])return normalizeFoodText(match[0]);
  }
  return null;
}

export function parseFoodIngredientLine(raw:string):ParsedFoodIngredientLine {
  const text=raw.trim().replace(/^ingredients?\s*[:\-–—]\s*/i,"").trim();
  if(!text)return {raw,ingredientText:"",quantity:null,quantityConfidence:0,prepState:null};
  const quantity=parseFoodQuantityFromText(text);
  let ingredientText=text;
  if(quantity){
    const escaped=quantity.sourceRaw.trim().replace(/[.*+?^{}()|[\]\\]/g,"\\export const AMBIGUOUS_COMPOUND_INGREDIENTS = new Set([");
    ingredientText=ingredientText.replace(new RegExp("\\b"+escaped.replace(/\\s+/g,"\\s+")+"\\b","i")," ").replace(/\s+/g," ").trim();
  } else {
    const countMatch=text.match(/^\s*\d+(?:[.,]\d+)?\s+/);
    if(countMatch){
      const canonicalProbe=canonicalizeIngredient(text);
      const inferred=parseFoodCountFromText(text,canonicalProbe.canonicalIngredient);
      if(inferred){
        ingredientText=text.slice(countMatch[0].length).trim();
        return {raw,ingredientText,quantity:inferred,quantityConfidence:0.82,prepState:detectPreparationState(text)};
      }
    }
  }
  return {
    raw,
    ingredientText,
    quantity,
    quantityConfidence:quantity?0.9:0,
    prepState:detectPreparationState(text),
  };
}

export const AMBIGUOUS_COMPOUND_INGREDIENTS = new Set([
  "pesto","ragu","brodo","gelatina","formaggio","pane","pasta","salsa"
]);

export function isAmbiguousCompoundIngredient(canonicalIngredient:string|null):boolean {
  return canonicalIngredient !== null
    && AMBIGUOUS_COMPOUND_INGREDIENTS.has(normalizeFoodText(canonicalIngredient));
}

export type SemanticStatus = "EXACT" | "INFERRED" | "UNKNOWN" | "AMBIGUOUS";
export type SemanticRelation = "EXACT" | "SYNONYM" | "RECIPE_GENERALIZES_PRODUCT" | "UNSAFE_GENERALIZATION" | "NONE";

const FOOD_PARENT: Readonly<Record<string,string>> = {
  mayonnaise:"salse",ketchup:"salse",senape:"salse",marmellata:"conserve",biscotti:"prodotti da forno",cracker:"prodotti da forno",salame:"carne",yogurt:"latticini",tofu:"proteine vegetali",seitan:"proteine vegetali",legumi:"legumi",carne:"proteine animali",pesce:"proteine animali",ortaggi:"vegetali",
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
  "salse","conserve","prodotti da forno","latticini","proteine vegetali","proteine animali","vegetali",
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
  role:"PRIMARY"|"SUBCOMPONENT";
  depth:number;
  path:string;
  parentCanonicalIngredient:string|null;
}

function splitTopLevel(text:string):string[] {
  const result:string[]=[]; let buffer=""; let depth=0;
  for(const char of text){
    if(char==="("||char==="["||char==="{")depth++;
    if(char===")"||char==="]"||char==="}")depth=Math.max(0,depth-1);
    if(depth===0&&(char===","||char===";")){
      if(buffer.trim())result.push(buffer.trim());
      buffer="";
    }else buffer+=char;
  }
  if(buffer.trim())result.push(buffer.trim());
  return result;
}

function extractNestedGroups(text:string):{outer:string;groups:string[]} {
  const groups:string[]=[]; let outer=""; let depth=0; let nested="";
  for(let i=0;i<text.length;i++){
    const char=text[i]!;
    if(char==="("||char==="["||char==="{"){
      if(depth===0){depth=1;nested="";continue;}
      depth++; nested+=char; continue;
    }
    if(char===")"||char==="]"||char==="}"){
      if(depth>1){depth--;nested+=char;continue;}
      if(depth===1){depth=0;if(nested.trim())groups.push(nested.trim());continue;}
    }
    if(depth===0)outer+=char; else nested+=char;
  }
  return {outer:outer.trim(),groups};
}

function parseIngredientSegments(raw:string,limit:number,parentCanonical:string|null,depth:number,pathPrefix:string,role:"PRIMARY"|"SUBCOMPONENT",out:FoodComponent[]):void {
  if(depth>3||out.length>=limit)return;
  const segments=splitTopLevel(raw);
  for(let index=0;index<segments.length&&out.length<limit;index++){
    const segment=segments[index]!.trim();
    if(!segment)continue;
    const {outer,groups}=extractNestedGroups(segment);
    const cleaned=outer
      .replace(/^ingredients?\s*:\s*/i,"")
      .replace(/^ingredients?\s*[-–—]\s*/i,"")
      .replace(/^[-*•]+\s*/,"")
      .trim();
    if(!cleaned)continue;
    const percentageMatch=cleaned.match(/(?:^|\s)(\d+(?:[.,]\d+)?)\s*%/);
    const percentage=percentageMatch?Number(percentageMatch[1]!.replace(",",".")):null;
    const name=cleaned.replace(/(?:^|\s)\d+(?:[.,]\d+)?\s*%/g," ").replace(/\s+/g," ").trim();
    const canonical=canonicalizeIngredient(name);
    const componentPath=pathPrefix ? pathPrefix+"."+index : String(index);
    out.push({
      raw:name,
      canonicalIngredient:canonical.confidence>=0.8?canonical.canonicalIngredient:null,
      ingredientTerms:canonical.ingredientTerms,
      percentage:Number.isFinite(percentage??0)?percentage:null,
      confidence:canonical.confidence,
      role,
      depth,
      path:componentPath,
      parentCanonicalIngredient:parentCanonical,
    });
    const currentCanonical=canonical.confidence>=0.8?canonical.canonicalIngredient:null;
    for(let groupIndex=0;groupIndex<groups.length&&out.length<limit;groupIndex++){
      parseIngredientSegments(groups[groupIndex]!,limit,currentCanonical,depth+1,componentPath+"."+groupIndex,"SUBCOMPONENT",out);
    }
  }
}

export function parseIngredientText(raw:string,limit=64):FoodComponent[] {
  const text=raw.trim();
  if(!text)return [];
  const components:FoodComponent[]=[];
  parseIngredientSegments(text,limit,null,0,"","PRIMARY",components);
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

export interface TextSafetyFacts {
  allergens: AllergenCode[];
  traceAllergens: AllergenCode[];
  explicitlyAbsent: AllergenCode[];
}

const TEXT_ALLERGEN_PATTERNS: ReadonlyArray<[RegExp,AllergenCode]> = [
  [/\bmilk\b|\blatte\b|\blait\b|\bleche\b|\bmilch\b/,"milk"],
  [/\bbutter\b|\bburro\b|\bbeurre\b|\bmantequilla\b|\bmargarine\b/,"milk"],
  [/\bcream\b|\bpanna\b|\bcreme\b|\bcrème\b|\bnata\b|\bsahne\b/,"milk"],
  [/\beggs?\b|\buova?\b|\boeufs?\b|\bhuevos?\b|\neier?\b/,"eggs"],
  [/\bgluten\b|\bwheat\b|\bflour\b|\bfarina\b|\bfarine\b|\bharina\b|\bmehl\b/,"gluten"],
  [/\bpeanuts?\b|\barachidi?\b|\barachide\b|\bcacahuetes?\b|\berdn[uü]sse?\b/,"peanuts"],
  [/\balmonds?\b|\bmandorle?\b|\bamandes?\b|\balmendras?\b|\bmandeln?\b/,"nuts"],
  [/\bwalnuts?\b|\bnoci\b|\bnoix\b|\bnueces?\b|\bwaln[uü]sse?\b/,"nuts"],
  [/\bhazelnuts?\b|\bnocciole?\b|\bnoisettes?\b|\bavellanas?\b|\bhaseln[uü]sse?\b/,"nuts"],
  [/\bpistachios?\b|\bpistacchi[oa]?\b|\bpistaches?\b|\bpistachos?\b|\bpistazien?\b/,"nuts"],
  [/\bsoya?\b|\bsoia\b|\bsoja\b|\bsojabohne[n]?\b/,"soybeans"],
  [/\bfish\b|\bpesce\b|\bpoisson\b|\bpescado\b|\bfisch\b/,"fish"],
  [/\bcrustaceans?\b|\bcrostacei\b|\bgamberi\b|\bcrustac[ée]s?\b|\bcrevettes?\b|\bcamarones?\b/,"crustaceans"],
  [/\bmolluscs?\b|\bmollusks?\b|\bmolluschi\b|\bmollusque?s?\b|\bmoluscos?\b/,"molluscs"],
  [/\bsesame\b|\bsesamo\b|\bs[eé]same\b|\bs[ée]samo\b/,"sesame-seeds"],
  [/\bmustard\b|\bsenape\b|\bmoutarde\b|\bmostaza\b|\bsenf\b/,"mustard"],
  [/\bcelery\b|\bsedano\b|\bc[eé]leri\b|\bapio\b/,"celery"],
];

const TRACE_CONTEXT = [
  /may contain/,
  /could contain/,
  /can contain/,
  /traces? of/,
  /contains? traces?/,
  /pu[oò] contenere/,
  /pu[oò] contenere tracce/,
  /tracce? di/,
  /pu[ée]ut contenir/,
  /traces? de/,
  /puede contener/,
  /trazas? de/,
  /kann enthalten/,
  /spuren? von/,
];

const ABSENCE_CONTEXT = [
  /does not contain/,
  /do not contain/,
  /without/,
  /free from/,
  /non contiene/,
  /senza/,
  /senza tracce/,
  /sans/,
  /sans traces?/,
  /sin/,
  /sin trazas?/,
  /ohne/,
  /ohne spuren?/,
];

export function inferTextSafetyFacts(raw:string):TextSafetyFacts {
  const text=normalizeFoodText(raw);
  const allergens=new Set<AllergenCode>();
  const traceAllergens=new Set<AllergenCode>();
  const explicitlyAbsent=new Set<AllergenCode>();
  if(!text)return {allergens:[],traceAllergens:[],explicitlyAbsent:[]};

  for(const [pattern,code] of TEXT_ALLERGEN_PATTERNS){
    const matches=text.matchAll(new RegExp(pattern.source,"gi"));
    for(const match of matches){
      const index=match.index ?? 0;
      const prefix=text.slice(Math.max(0,index-96),index);
      const trace=TRACE_CONTEXT.some(marker=>marker.test(prefix));
      const absent=ABSENCE_CONTEXT.some(marker=>marker.test(prefix));
      if(absent) explicitlyAbsent.add(code);
      else if(trace) traceAllergens.add(code);
      else allergens.add(code);
    }
  }
  return {
    allergens:[...allergens],
    traceAllergens:[...traceAllergens],
    explicitlyAbsent:[...explicitlyAbsent],
  };
}

export function inferTextAllergens(raw:string):AllergenCode[] {
  return inferTextSafetyFacts(raw).allergens;
}

export function inferIngredientAllergens(canonicalIngredient:string|null, terms:readonly string[]=[]):AllergenCode[] {
  const values=new Set<AllergenCode>();
  if(canonicalIngredient){
    for(const code of INGREDIENT_ALLERGENS[normalizeFoodText(canonicalIngredient)] ?? []) values.add(code);
  }
  for(const term of terms){
    const canonical=canonicalizeIngredient(term).canonicalIngredient;
    for(const code of INGREDIENT_ALLERGENS[normalizeFoodText(canonical ?? "")] ?? []) values.add(code);
    for(const code of inferTextAllergens(term)) values.add(code);
  }
  for(const code of inferTextAllergens(canonicalIngredient ?? "")) values.add(code);
  return [...values];
}
