import type { StockItem, ExpiryStatus } from "../types";

export function expiryDays(batches: StockItem["batches"]): number | null {
  const dates = batches.map((b) => b.expiryDate).filter(Boolean) as string[];
  if (!dates.length) return null;
  const nearest = Math.min(...dates.map((d) => new Date(d).getTime()));
  return Math.ceil((nearest - Date.now()) / 86400000);
}

export function getExpiryStatus(batches: StockItem["batches"]): ExpiryStatus {
  const days = expiryDays(batches);
  if (days === null) return "UNKNOWN";
  if (days <= 0) return "EXPIRED";
  if (days <= 5) return "EXPIRING";
  return "FRESH";
}

export function formatExpiryLabel(days: number): string {
  if (days <= 0) return "Scaduto";
  if (days === 1) return "Scade domani";
  return `Scade in ${days}g`;
}
