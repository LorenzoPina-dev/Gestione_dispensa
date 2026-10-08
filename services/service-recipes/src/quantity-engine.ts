export type QuantityDimension = "mass" | "volume" | "count";

export interface UnitInfo {
  dimension: QuantityDimension;
  factor: number;
  baseUnit: "g" | "ml" | "piece";
}

const UNITS:Readonly<Record<string,UnitInfo>>={
  mg:{dimension:"mass",factor:0.001,baseUnit:"g"},
  g:{dimension:"mass",factor:1,baseUnit:"g"},
  kg:{dimension:"mass",factor:1000,baseUnit:"g"},
  oz:{dimension:"mass",factor:28.349523125,baseUnit:"g"},
  lb:{dimension:"mass",factor:453.59237,baseUnit:"g"},
  ml:{dimension:"volume",factor:1,baseUnit:"ml"},
  cl:{dimension:"volume",factor:10,baseUnit:"ml"},
  dl:{dimension:"volume",factor:100,baseUnit:"ml"},
  l:{dimension:"volume",factor:1000,baseUnit:"ml"},
  tsp:{dimension:"volume",factor:5,baseUnit:"ml"},
  "tsp.":{dimension:"volume",factor:5,baseUnit:"ml"},
  teaspoon:{dimension:"volume",factor:5,baseUnit:"ml"},
  teaspoons:{dimension:"volume",factor:5,baseUnit:"ml"},
  tbsp:{dimension:"volume",factor:15,baseUnit:"ml"},
  "tbsp.":{dimension:"volume",factor:15,baseUnit:"ml"},
  tablespoon:{dimension:"volume",factor:15,baseUnit:"ml"},
  tablespoons:{dimension:"volume",factor:15,baseUnit:"ml"},
  cup:{dimension:"volume",factor:240,baseUnit:"ml"},
  cups:{dimension:"volume",factor:240,baseUnit:"ml"},
  piece:{dimension:"count",factor:1,baseUnit:"piece"},
  pieces:{dimension:"count",factor:1,baseUnit:"piece"},
  pc:{dimension:"count",factor:1,baseUnit:"piece"},
  pcs:{dimension:"count",factor:1,baseUnit:"piece"},
  pz:{dimension:"count",factor:1,baseUnit:"piece"},
  pezzo:{dimension:"count",factor:1,baseUnit:"piece"},
  pezzi:{dimension:"count",factor:1,baseUnit:"piece"},
  unit:{dimension:"count",factor:1,baseUnit:"piece"},
  units:{dimension:"count",factor:1,baseUnit:"piece"},
  u:{dimension:"count",factor:1,baseUnit:"piece"}
};

export function normalizeUnit(unit:string):string{
  return unit.trim().toLowerCase().replace(/\.$/,"").replace(/_/g," ");
}
export function unitInfo(unit:string):UnitInfo|null{
  return UNITS[normalizeUnit(unit)]??null;
}

export function parseAmount(value:string):number|null{
  const text=value.trim().replace(",",".");
  if(!text) return null;
  const fraction=text.match(/^(\d+)\s*\/\s*(\d+)$/);
  if(fraction){
    const numerator=Number(fraction[1]),denominator=Number(fraction[2]);
    return denominator>0?numerator/denominator:null;
  }
  const mixed=text.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if(mixed){
    const whole=Number(mixed[1]),numerator=Number(mixed[2]),denominator=Number(mixed[3]);
    return denominator>0?whole+numerator/denominator:null;
  }
  const numeric=Number(text);
  return Number.isFinite(numeric)?numeric:null;
}

export interface ParsedQuantity {
  value:number;
  unit:string;
  dimension:QuantityDimension;
  baseValue:number;
  baseUnit:"g"|"ml"|"piece";
  confidence:number;
  sourceRaw:string;
}

export function parseQuantity(value:string|number, unit:string):ParsedQuantity|null{
  const numeric=typeof value==="number"?value:parseAmount(value);
  const info=unitInfo(unit);
  if(numeric===null || numeric<=0 || !info) return null;
  return {
    value:numeric,
    unit:normalizeUnit(unit),
    dimension:info.dimension,
    baseValue:numeric*info.factor,
    baseUnit:info.baseUnit,
    confidence:1,
    sourceRaw:String(value)+" "+String(unit).trim()
  };
}

const UNIT_PATTERN="kg|mg|g|lb|oz|dl|cl|ml|l|tbsp\\.?|tsp\\.?|tablespoons?|teaspoons?|cups?|pieces?|pcs?|pc|pz|pezzi?|unità|unita|units?|u";
export function parseQuantityFromText(raw:string):ParsedQuantity|null{
  const match=raw.trim().match(new RegExp("(?:(\\d+\\s+)?(\\d+\\s*\\/\\s*\\d+)|(\\d+\\s*\\/\\s*\\d+)|(\\d+(?:[.,]\\d+)?))\\s*("+UNIT_PATTERN+")\\b","i"));
  if(!match) return null;
  const amountText=match[1]?String(match[1]).trim():match[2]??match[3]??match[4]??"";
  const amount=parseAmount(amountText);
  const unit=match[5];
  return amount===null?null:parseQuantity(amount,unit);
}

export function convert(value:number,fromUnit:string,toUnit:string):number|null{
  const from=unitInfo(fromUnit),to=unitInfo(toUnit);
  if(!from||!to||from.dimension!==to.dimension)return null;
  return value*from.factor/to.factor;
}

export function combineInventoryQuantity(
  quantity:number,
  unit:string,
  packageQuantity:{value:number;unit:"g"|"ml"|"piece"}|null|undefined
):ParsedQuantity|null{
  const direct=parseQuantity(quantity,unit);
  if(direct)return direct;
  const normalized=normalizeUnit(unit);
  if(["pack","packs","conf","confezione","confezioni"].includes(normalized) && packageQuantity){
    const total=quantity*packageQuantity.value;
    return {value:total,unit:packageQuantity.unit,dimension:packageQuantity.unit==="g"?"mass":packageQuantity.unit==="ml"?"volume":"count",baseValue:total,baseUnit:packageQuantity.unit,confidence:0.94,sourceRaw:String(quantity)+" "+unit};
  }
  return null;
}

export interface QuantityCoverage {
  status:"COMPLETE"|"PARTIAL"|"MISSING"|"PRESENCE_ONLY"|"INCOMPATIBLE"|"UNKNOWN";
  ratio:number;
  availableBase:number|null;
  requiredBase:number|null;
  missingBase:number|null;
  dimension:QuantityDimension|null;
}

export function quantityCoverage(required:ParsedQuantity|null,available:ParsedQuantity[]):QuantityCoverage{
  if(!required){
    return available.length>0
      ? {status:"PRESENCE_ONLY",ratio:1,availableBase:null,requiredBase:null,missingBase:null,dimension:null}
      : {status:"MISSING",ratio:0,availableBase:null,requiredBase:null,missingBase:null,dimension:null};
  }
  const compatible=available.filter(item=>item.dimension===required.dimension);
  if(compatible.length===0){
    return available.length>0
      ? {status:"INCOMPATIBLE",ratio:0,availableBase:0,requiredBase:required.baseValue,missingBase:required.baseValue,dimension:required.dimension}
      : {status:"MISSING",ratio:0,availableBase:0,requiredBase:required.baseValue,missingBase:required.baseValue,dimension:required.dimension};
  }
  const availableBase=compatible.reduce((sum,item)=>sum+item.baseValue,0);
  const ratio=Math.max(0,Math.min(1,availableBase/required.baseValue));
  return {
    status:ratio>=1?"COMPLETE":ratio>0?"PARTIAL":"MISSING",
    ratio,
    availableBase,
    requiredBase:required.baseValue,
    missingBase:Math.max(0,required.baseValue-availableBase),
    dimension:required.dimension
  };
}
