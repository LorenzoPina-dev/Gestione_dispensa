import { convertFoodQuantityWithDensity, foodQuantity, foodUnitInfo, parseFoodQuantityFromText } from "@gestione-dispensa/food-rules";

export type QuantityDimension = "mass" | "volume" | "count";

export interface UnitInfo {
  family: QuantityDimension;
  factor: number;
}

export function normalizeUnit(unit:string):string{
  return unit.trim().toLowerCase().replace(/\.$/,"").replace(/_/g," ");
}

export function unitInfo(unit:string):UnitInfo|null{
  const info=foodUnitInfo(normalizeUnit(unit));
  return info ? {family:info.dimension,factor:info.factor} : null;
}

export function parseAmount(value:string):number|null{
  const normalized=value.trim().replace(",",".");
  const mixed=normalized.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if(mixed){
    const denominator=Number(mixed[3]);
    return denominator>0?Number(mixed[1])+Number(mixed[2])/denominator:null;
  }
  const fraction=normalized.match(/^(\d+)\s*\/\s*(\d+)$/);
  if(fraction){
    const denominator=Number(fraction[2]);
    return denominator>0?Number(fraction[1])/denominator:null;
  }
  const numeric=Number(normalized);
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

export function parseQuantity(value:number|string,unit:string):ParsedQuantity|null{
  const parsed=foodQuantity(value,unit);
  return parsed ? {
    ...parsed,
    confidence:1,
  } : null;
}

export function parseQuantityFromText(raw:string):ParsedQuantity|null{
  const parsed=parseFoodQuantityFromText(raw);
  return parsed ? {
    ...parsed,
    confidence:0.9,
  } : null;
}

export function convert(value:number,fromUnit:string,toUnit:string):number|null{
  const from=foodUnitInfo(normalizeUnit(fromUnit));
  const to=foodUnitInfo(normalizeUnit(toUnit));
  if(!from||!to||from.dimension!==to.dimension)return null;
  return value*from.factor/to.factor;
}

export function combineInventoryQuantity(
  quantity:number,
  unit:string,
  packageQuantity:{value:number;unit:"g"|"ml"|"piece"}|null|undefined,
  openedAt?:string|null,
  remainingContent?:{value:number;unit:"g"|"kg"|"ml"|"l"|"piece"}|null,
):ParsedQuantity|null{
  const normalized=normalizeUnit(unit);
  if(openedAt && remainingContent){
    const remaining=foodQuantity(remainingContent.value,remainingContent.unit);
    if(remaining) return {...remaining,confidence:0.96,sourceRaw:String(remainingContent.value)+" "+remainingContent.unit};
    return null;
  }
  const direct=parseQuantity(quantity,unit);
  if(direct)return direct;
  if(["pack","packs","conf","confezione","confezioni"].includes(normalized) && packageQuantity){
    if(openedAt) return null;
    const total=quantity*packageQuantity.value;
    return {
      value:total,
      unit:packageQuantity.unit,
      dimension:packageQuantity.unit==="g"?"mass":packageQuantity.unit==="ml"?"volume":"count",
      baseValue:total,
      baseUnit:packageQuantity.unit,
      confidence:0.94,
      sourceRaw:String(quantity)+" "+unit,
    };
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

export function quantityCoverage(required:ParsedQuantity|null,available:ParsedQuantity[],canonicalIngredient:string|null=null):QuantityCoverage{
  const normalizedAvailable=required && canonicalIngredient
    ? available.map(item=>{
        if(item.dimension===required.dimension)return item;
        const converted=convertFoodQuantityWithDensity(item.value,item.unit,canonicalIngredient,required.baseUnit==="g"?"g":required.baseUnit==="ml"?"ml":"piece");
        if(!converted)return item;
        return {...converted,confidence:Math.min(item.confidence,0.9)};
      })
    : available;
  if(!required){
    return available.length>0
      ? {status:"PRESENCE_ONLY",ratio:1,availableBase:null,requiredBase:null,missingBase:null,dimension:null}
      : {status:"MISSING",ratio:0,availableBase:null,requiredBase:null,missingBase:null,dimension:null};
  }
  const compatible=normalizedAvailable.filter(item=>item.dimension===required.dimension);
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
