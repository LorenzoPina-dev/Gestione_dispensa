export interface OcrQueueMessage { data?: { jobId?: string; familyId?: string; userId?: string; objectKey?: string; type?: string } }
export function parseOcrQueueMessage(raw: string): OcrQueueMessage | null {
  try { const value: unknown=JSON.parse(raw); return value && typeof value==="object" ? value as OcrQueueMessage : null; } catch { return null; }
}
export function ocrProcessBody(data: NonNullable<OcrQueueMessage["data"]>) {
  return { familyId:data.familyId??null,userId:data.userId??null,objectKey:data.objectKey??null,type:data.type??"receipt" };
}
