import { createClient } from "redis";
import { Pool } from "pg";

const redis = createClient({ url: process.env.REDIS_URL ?? "redis://redis:6379" });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const horizonDays = Number(process.env.SHELF_LIFE_SCAN_HORIZON_DAYS ?? 30);
const scanIntervalMs = Number(process.env.SHELF_LIFE_SCAN_INTERVAL_MS ?? 21_600_000);
const queue = "q:shelf-life-prediction";

await redis.connect();
console.log(JSON.stringify({ worker: "worker-shelf-life", queue, scanIntervalMs }));

async function processPrediction(element: string) {
  const e = JSON.parse(element) as { data?: { stockItemId?: string; category?: string; storageLocation?: string; insertedAt?: string } };
  const d = e.data ?? {};
  if (!d.stockItemId) return;
  const storage = String(d.storageLocation ?? "OTHER").toUpperCase();
  const rule = await pool.query(
    `select * from shelf_life_domain.rules where category=$1 and storage_kind=$2
     union all select * from shelf_life_domain.rules where category='__default__' and storage_kind=$2 limit 1`,
    [String(d.category ?? "__default__").trim().toLowerCase(), storage],
  );
  if (!rule.rowCount || rule.rows[0].estimated_days == null) return;
  const expiry = new Date(d.insertedAt ?? Date.now());
  expiry.setUTCDate(expiry.getUTCDate() + Number(rule.rows[0].estimated_days));
  await pool.query(
    `update stock_lots set expires_at=$2, expiry_source='ESTIMATED'
     where stock_item_id=$1 and expires_at is null and coalesce(quantity_snapshot,0)>0`,
    [d.stockItemId, expiry.toISOString()],
  );
}

async function scanExpiringLots() {
  const now = new Date();
  const horizon = new Date(now);
  horizon.setUTCDate(horizon.getUTCDate() + horizonDays);
  const candidates = await pool.query(
    `select sl.id lot_id, si.family_id, p.canonical_name product_name,
            p.category, l.kind storage_kind, sl.quantity_snapshot quantity,
            si.unit, sl.expires_at
       from stock_lots sl
       join stock_items si on si.id=sl.stock_item_id
       join products p on p.id=si.product_id
       left join locations l on l.id=sl.location_id
      where si.status='ACTIVE' and sl.expires_at is not null
        and sl.expiry_notified_at is null and sl.expires_at <= $1
        and coalesce(sl.quantity_snapshot,0)>0`,
    [horizon],
  );
  let notified = 0;
  for (const lot of candidates.rows) {
    const storage = String(lot.storage_kind ?? "OTHER").toUpperCase();
    const rule = await pool.query(
      `select notify_days_before from shelf_life_domain.rules where category=$1 and storage_kind=$2
       union all select notify_days_before from shelf_life_domain.rules where category='__default__' and storage_kind=$2 limit 1`,
      [String(lot.category ?? "__default__").trim().toLowerCase(), storage],
    );
    const notifyDays = Number(rule.rows[0]?.notify_days_before ?? 2);
    const days = Math.ceil((new Date(lot.expires_at).getTime() - now.getTime()) / 86_400_000);
    if (days > notifyDays) continue;
    const date = new Date(lot.expires_at).toLocaleDateString("it-IT", { day: "numeric", month: "long" });
    const inserted = await pool.query(
      `insert into notifications(family_id,category,title,body)
       values($1,'EXPIRY',$2,$3) returning id`,
      [lot.family_id, `In scadenza: ${lot.product_name}`, `Hai ${lot.quantity} ${lot.unit} in scadenza il ${date}.`],
    );
    if (inserted.rowCount) {
      await pool.query(`update stock_lots set expiry_notified_at=$2 where id=$1`, [lot.lot_id, now]);
      notified++;
    }
  }
  return { scanned: candidates.rowCount ?? 0, notified };
}

let stopping = false;
const shutdown = async () => { if (stopping) return; stopping = true; await redis.quit().catch(() => undefined); await pool.end().catch(() => undefined); };
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

async function run() {
  const scan = async () => {
    try { const result = await scanExpiringLots(); if (result.scanned) console.log(JSON.stringify({ event: "shelf_life_expiry_scan", ...result })); }
    catch (error) { console.error("shelf_life_scan_error", error); }
  };
  await scan();
  const timer = setInterval(scan, scanIntervalMs);
  timer.unref();
  while (!stopping) {
    const item = await redis.brPop(queue, 1);
    if (item) {
      try { await processPrediction(item.element); }
      catch (error) { console.error("shelf_life_worker_error", error); }
    }
  }
}
await run();
