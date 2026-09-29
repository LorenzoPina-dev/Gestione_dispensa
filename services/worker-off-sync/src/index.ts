import { createClient } from "redis";
const redis=createClient({url:process.env.REDIS_URL??"redis://redis:6379"});
const base=(process.env.OFF_LOOKUP_BASE_URL??"http://off-lookup:3200").replace(/\/$/,"");
await redis.connect();
console.log(JSON.stringify({worker:"worker-off-sync",queue:"q:off-enrichment"}));
while(true){const item=await redis.brPop("q:off-enrichment",0);if(!item)continue;try{const e=JSON.parse(item.element);const barcode=e.data.barcode;await fetch(`${base}/api/v1/products/${encodeURIComponent(barcode)}`);}catch(err){console.error("off_sync_worker_error",err)}}
