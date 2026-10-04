// Diagnosi: gli imageUrl salvati nell'indice OpenSearch esistono davvero?
//
// Va eseguito nel container off-lookup, perche' e' l'unico con accesso a Internet
// (search-indexer sta solo su reti interne). Non modifica nulla.
//
// Uso (PowerShell, dalla radice del repo):
//   Get-Content tools\check-index-images.mjs | docker compose exec -T off-lookup node --input-type=module
//
// Variabili opzionali: N (campione, default 200), OPENSEARCH_URL (default http://opensearch:9200).

const base = (process.env.OPENSEARCH_URL || "http://opensearch:9200").replace(/\/+$/, "");
const N = Number(process.env.N || 200);

const response = await fetch(`${base}/off-products-v1/_search`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    size: N,
    _source: ["code", "name", "imageUrl"],
    query: {
      function_score: {
        query: { bool: { filter: [{ range: { completeness: { gte: 0.7 } } }] } },
        random_score: {},
      },
    },
  }),
});
if (!response.ok) throw new Error(`opensearch_${response.status}`);

const hits = (await response.json()).hits.hits.map((h) => h._source);
const withUrl = hits.filter((h) => typeof h.imageUrl === "string" && h.imageUrl.length > 0);
const withoutUrl = hits.filter((h) => !(typeof h.imageUrl === "string" && h.imageUrl.length > 0));

async function probe(url) {
  try {
    let r = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(8000) });
    if (r.status === 405 || r.status === 403) {
      r = await fetch(url, { method: "GET", headers: { Range: "bytes=0-0" }, redirect: "follow", signal: AbortSignal.timeout(8000) });
    }
    return String(r.status);
  } catch (error) {
    return "errore:" + (error?.cause?.code || error?.name || "sconosciuto");
  }
}

const results = [];
const queue = [...withUrl];
await Promise.all(Array.from({ length: 8 }, async () => {
  while (queue.length > 0) {
    const item = queue.shift();
    results.push({ ...item, status: await probe(item.imageUrl) });
  }
}));

const byStatus = {};
const byHost = {};
for (const r of results) {
  byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  const host = /^https?:\/\/([^\/]+)/i.exec(r.imageUrl)?.[1] ?? "(non http)";
  byHost[host] = byHost[host] || {};
  byHost[host][r.status] = (byHost[host][r.status] || 0) + 1;
}

const pct = (n) => ((n / hits.length) * 100).toFixed(1) + "%";
console.log(`Campione casuale di prodotti ammessi in ricerca: ${hits.length}`);
console.log(`- senza imageUrl nell'indice: ${withoutUrl.length} (${pct(withoutUrl.length)})`);
console.log(`- con imageUrl: ${withUrl.length} (${pct(withUrl.length)})`);
console.log("");
console.log("Risposta HTTP degli imageUrl presenti (200 = immagine ok):");
console.log(JSON.stringify(byStatus, null, 2));
console.log("");
console.log("Per host:");
console.log(JSON.stringify(byHost, null, 2));
console.log("");
console.log("Esempi di imageUrl NON raggiungibili:");
console.log(JSON.stringify(results.filter((r) => !r.status.startsWith("2")).slice(0, 5), null, 2));
console.log("");
console.log("Esempi di prodotti senza imageUrl:");
console.log(JSON.stringify(withoutUrl.slice(0, 5), null, 2));
