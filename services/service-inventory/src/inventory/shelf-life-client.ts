export type CoreStorageKind = "PANTRY" | "FRIDGE" | "FREEZER" | "CELLAR" | "OTHER";
export interface ShelfLifeEstimate { expiresAt?: Date | undefined; notifyDaysBefore: number; }
export interface ShelfLifeEstimator { estimate(input: { category?: string | undefined; storageKind: CoreStorageKind; receivedAt: Date }): Promise<ShelfLifeEstimate>; }
export class HttpShelfLifeEstimator implements ShelfLifeEstimator {
  constructor(private readonly baseUrl: string, private readonly timeoutMs = 3000) {}
  async estimate(input: { category?: string | undefined; storageKind: CoreStorageKind; receivedAt: Date }): Promise<ShelfLifeEstimate> {
    const url = new URL("/shelf-life/predict", this.baseUrl.replace(/\/$/, "") + "/");
    if (input.category) url.searchParams.set("category", input.category);
    url.searchParams.set("storageKind", input.storageKind);
    url.searchParams.set("insertedAt", input.receivedAt.toISOString());
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!r.ok) return { notifyDaysBefore: 2 };
      const body = await r.json() as { data?: { expirationDate?: string | null; notifyDaysBefore?: number } };
      const d = body.data?.expirationDate;
      return { expiresAt: d ? new Date(`${d}T00:00:00.000Z`) : undefined, notifyDaysBefore: Number(body.data?.notifyDaysBefore ?? 2) };
    } catch { return { notifyDaysBefore: 2 }; }
  }
}
export function normalizeStorageKind(value: string | undefined | null): CoreStorageKind {
  const normalized=value?.trim().toLowerCase();
  if (normalized === "frigo" || normalized === "fridge" || normalized === "frigorifero") return "FRIDGE";
  if (normalized === "freezer" || normalized === "congelatore") return "FREEZER";
  if (normalized === "dispensa" || normalized === "pantry") return "PANTRY";
  if (normalized === "cantina" || normalized === "cellar") return "CELLAR";
  return "OTHER";
}
