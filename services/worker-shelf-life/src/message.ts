export interface ShelfLifeQueueMessage { data?: { predictionId?: string; itemId?: string; productId?: string; storage?: string; opened?: boolean; category?: string|null; userId?: string; familyId?: string } }
export function parseShelfLifeQueueMessage(raw: string): ShelfLifeQueueMessage | null {
  try { const value: unknown=JSON.parse(raw); return value && typeof value==="object" ? value as ShelfLifeQueueMessage : null; } catch { return null; }
}
export function shelfLifeProcessBody(data: NonNullable<ShelfLifeQueueMessage["data"]>) {
  return { itemId:data.itemId,productId:data.productId,storedAt:data.storage,opened:data.opened??false,...(data.category?{category:data.category}: {}) };
}
