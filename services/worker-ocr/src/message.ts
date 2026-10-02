export interface OcrQueueMessage { data?: { jobId?: string; familyId?: string; userId?: string; objectKey?: string; type?: string } }
export function parseOcrQueueMessage(raw: string): OcrQueueMessage | null {
  try { const value: unknown=JSON.parse(raw); if(value===null || typeof value!=="object" || Array.isArray(value)) return null; return value as OcrQueueMessage; } catch { return null; }
}
export function ocrProcessBody(data: NonNullable<OcrQueueMessage["data"]>) {
  return { familyId:data.familyId??null,userId:data.userId??null,objectKey:data.objectKey??null,type:data.type??"receipt" };
}
