import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createContextAwarePool } from "@gestione-dispensa/runtime-db/postgres-client.js";

const URL = process.env.RECIPE_DATASET_URL ?? "https://zenodo.org/records/14068000/files/italian%20gastronomic%20recipes%20dataset.zip?download=1";
const MD5 = "b90427179a4304270fd5b7b7490b565d";
const KEY = "italian-gastronomic-recipes-v4";
const SOURCE = "italian-gastronomic-recipes-v4";
const WORK = "/tmp/italian-recipes";

function norm(s) { return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim(); }
function csv(text) {
  const out=[], row=[]; let current=row, field="", quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];
    if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}
    else if(c===','&&!quoted){current.push(field);field="";}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;current.push(field);field="";if(current.some(x=>x.trim()))out.push(current.splice(0));}
    else field+=c;
  }
  if(field||current.length){current.push(field);out.push(current.splice(0));}
  return out;
}
function find(root,name){const stack=[root];while(stack.length){const d=stack.pop();for(const e of readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())stack.push(p);else if(e.name.toLowerCase()===name.toLowerCase())return p;}}throw new Error(name+" not found");}
function num(v){if(!v||!String(v).trim())return null;const n=Number(String(v).replace(",","."));return Number.isFinite(n)?n:null;}
function uuid(id){const b=Buffer.from(createHash("sha256").update(SOURCE+":"+id).digest("hex").slice(0,32),"hex");b[6]=(b[6]&15)|80;b[8]=(b[8]&63)|128;const h=b.toString("hex");return h.slice(0,8)+"-"+h.slice(8,12)+"-"+h.slice(12,16)+"-"+h.slice(16,20)+"-"+h.slice(20);}
function terms(s){const n=norm(s);return [...new Set([n,...n.split(" ").filter(x=>x.length>=3)])];}

async function main(){
 const pool=createContextAwarePool({connectionString:process.env.DATABASE_URL});
 const ready=await pool.query("select source_md5,recipe_count from recipe_catalog.datasets where dataset_key=$1",[KEY]);
 if(ready.rowCount&&String(ready.rows[0].source_md5)===MD5&&Number(ready.rows[0].recipe_count)>0&&process.env.RECIPE_DATASET_FORCE_REIMPORT!=="1"){console.log(JSON.stringify({event:"recipe_dataset_ready",recipes:Number(ready.rows[0].recipe_count)}));await pool.end();return;}
 mkdirSync(WORK,{recursive:true});const zip=path.join(WORK,"dataset.zip"),ext=path.join(WORK,"dataset");rmSync(ext,{recursive:true,force:true});
 const response=await fetch(URL,{signal:AbortSignal.timeout(120000)});if(!response.ok)throw new Error("dataset HTTP "+response.status);
 const data=Buffer.from(await response.arrayBuffer());const md5=createHash("md5").update(data).digest("hex");if(md5!==MD5)throw new Error("dataset MD5 mismatch: "+md5);
 writeFileSync(zip,data);mkdirSync(ext,{recursive:true});execFileSync("unzip",["-q","-o",zip,"-d",ext]);
 const rows=csv(readFileSync(find(ext,"recipes.csv"),"utf8"));const h=rows[0].map(norm);
 const idx=(names)=>{for(const n of names){const i=h.indexOf(norm(n));if(i>=0)return i;}return -1;};
 const id=idx(["id"]),title=idx(["name"]),category=idx(["category name"]),cost=idx(["cost"]),difficulty=idx(["difficulty"]),time=idx(["preparation time"]),link=idx(["link"]);
 const ing=h.map((x,i)=>x==="ingredient"?i:-1).filter(i=>i>=0),ingId=h.map((x,i)=>x==="ingredient id"?i:-1).filter(i=>i>=0),weights=h.map((x,i)=>(x==="weight"||x==="w")?i:-1).filter(i=>i>=0),steps=h.map((x,i)=>x==="preparation"?i:-1).filter(i=>i>=0);
 if(id<0||title<0||!ing.length)throw new Error("unexpected recipes.csv schema");
 const client=await pool.connect();let count=0;
 try{await client.query("begin");await client.query("delete from recipe_catalog.recipes where source=$1",[SOURCE]);
 for(const r of rows.slice(1)){const sourceId=(r[id]||"").trim(),name=(r[title]||"").trim();if(!sourceId||!name)continue;const rid=uuid(sourceId);
  await client.query("insert into recipe_catalog.recipes(id,source,source_recipe_id,title,category,cost,difficulty,prep_time_minutes,source_url) values($1,$2,$3,$4,$5,$6,$7,$8,$9)",[rid,SOURCE,sourceId,name,category>=0?r[category]||null:null,cost>=0?num(r[cost]):null,difficulty>=0?num(r[difficulty]):null,time>=0?num(r[time]):null,link>=0?r[link]||null:null]);
  let p=0;for(let j=0;j<ing.length;j++){const n=(r[ing[j]]||"").trim();if(!n)continue;p++;await client.query("insert into recipe_catalog.recipe_ingredients(id,recipe_id,position,source_ingredient_id,name,display_name,weight,terms) values($1,$2,$3,$4,$5,$6,$7,$8)",[randomUUID(),rid,p,ingId[j]!==undefined?(r[ingId[j]]||"").trim()||null:null,n,n,num(r[weights[j]]),terms(n)]);}
  let s=0;for(const c of steps){const text=(r[c]||"").trim();if(text){s++;await client.query("insert into recipe_catalog.recipe_steps(id,recipe_id,position,instruction) values($1,$2,$3,$4)",[randomUUID(),rid,s,text]);}}
  count++;if(count%250===0)console.log(JSON.stringify({event:"recipe_dataset_progress",recipes:count}));
 }
 await client.query("insert into recipe_catalog.datasets(dataset_key,source_url,source_md5,recipe_count) values($1,$2,$3,$4) on conflict(dataset_key) do update set source_url=excluded.source_url,source_md5=excluded.source_md5,recipe_count=excluded.recipe_count,imported_at=now()",[KEY,URL,MD5,count]);await client.query("commit");console.log(JSON.stringify({event:"recipe_dataset_imported",recipes:count}));
 }catch(e){await client.query("rollback");throw e;}finally{client.release();await pool.end();rmSync(WORK,{recursive:true,force:true});}
}
main().catch(e=>{console.error(JSON.stringify({event:"recipe_dataset_import_failed",error:e instanceof Error?e.message:String(e)}));process.exit(1);});
