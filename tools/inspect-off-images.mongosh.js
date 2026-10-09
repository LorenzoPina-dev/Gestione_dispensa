// Diagnosi: in che forma sono salvate le immagini nei documenti Mongo che finiscono in ricerca?
//
// Uso (PowerShell, dalla radice del repo):
//   Get-Content tools\inspect-off-images.mongosh.js | docker compose exec -T mongodb mongosh off_lookup_db --quiet
//
// Legge un campione casuale (non modifica nulla) e classifica ogni prodotto ammesso in ricerca
// (completeness >= 0.7) in base a quale informazione immagine contiene davvero.

const SAMPLE = 5000;
const MIN_COMPLETENESS = 0.7;

const docs = db.products.aggregate([
  { $sample: { size: SAMPLE } },
  { $match: { completeness: { $gte: MIN_COMPLETENESS } } },
  { $project: {
      _id: 0, code: 1, product_name: 1,
      image_front_url: 1, image_front_small_url: 1, image_front_thumb_url: 1, image_url: 1,
      selected_images: 1, images: 1,
  } },
], { allowDiskUse: true }).toArray();

const isStr = (v) => typeof v === "string" && v.length > 0;
const hostOf = (u) => { const m = /^https?:\/\/([^\/]+)/i.exec(u); return m ? m[1] : "(non http)"; };

const tally = {};
const examples = {};
const hosts = {};

function bump(cls, example) {
  tally[cls] = (tally[cls] || 0) + 1;
  if (!examples[cls]) examples[cls] = [];
  if (examples[cls].length < 3) examples[cls].push(example);
}

for (const d of docs) {
  const imgs = d.images && typeof d.images === "object" ? d.images : {};
  const keys = Object.keys(imgs);
  const frontKeys = keys.filter((k) => /^front/i.test(k));
  const frontWithRev = frontKeys.filter((k) => imgs[k] && imgs[k].rev != null);
  const direct = [d.image_front_small_url, d.image_front_url, d.image_front_thumb_url].find(isStr);
  const hasSelectedFront = !!(d.selected_images && d.selected_images.front);

  if (direct) {
    hosts[hostOf(direct)] = (hosts[hostOf(direct)] || 0) + 1;
    bump("A  campo diretto image_front_*_url", { code: d.code, url: direct });
  } else if (frontWithRev.length > 0) {
    const k = frontWithRev[0];
    bump("B  nessun URL, ma images.front_*.rev (URL calcolabile)", {
      code: d.code, frontKeys, [k]: imgs[k],
    });
  } else if (hasSelectedFront) {
    bump("C  solo selected_images.front", { code: d.code, selected_front: d.selected_images.front });
  } else if (keys.length > 0) {
    bump("D  images presente ma senza chiavi front*", { code: d.code, keys: keys.slice(0, 12) });
  } else {
    bump("E  nessun dato immagine", { code: d.code, name: d.product_name });
  }
}

print("Campione richiesto: " + SAMPLE + " | ammessi (completeness >= " + MIN_COMPLETENESS + "): " + docs.length);
print("");
for (const cls of Object.keys(tally).sort()) {
  print(cls + ": " + tally[cls] + "  (" + ((tally[cls] / docs.length) * 100).toFixed(1) + "%)");
}
print("");
print("Host degli URL diretti (classe A):");
printjson(hosts);
print("");
print("Esempi per classe:");
printjson(examples);
