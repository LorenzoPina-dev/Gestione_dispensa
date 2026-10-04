/**
 * Receipt scan journey: upload -> OCR job polling -> draft. Mirrors the explicit
 * conflict/offline/retryable vocabulary of the other journeys. A receipt that cannot be read
 * (OCR provider disabled, low confidence, timeout) degrades to MANUAL_REQUIRED, never to a
 * made-up extraction (docs/API.md §11: low confidence => needs_review, no false extractions).
 */
export type ReceiptScanState =
  | "IDLE"
  | "UPLOADING"
  | "PROCESSING"
  | "READY"
  | "MANUAL_REQUIRED"
  | "FAILED"
  | "OFFLINE";

export interface ReceiptScanModel {
  readonly state: ReceiptScanState;
  readonly jobId?: string;
  readonly draftId?: string;
  readonly progress: number;
  readonly polls: number;
  readonly message: string;
}

export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;
export const RECEIPT_MIME_TYPES: readonly string[] = ["image/jpeg", "image/png", "image/webp"];
export const RECEIPT_MAX_POLLS = 40;
export const RECEIPT_POLL_INTERVAL_MS = 1500;

export interface ReceiptJobSnapshot {
  readonly status: string;
  readonly progress: number;
  readonly draftId: string | null;
  readonly error: string | null;
}

export function initialReceiptScan(): ReceiptScanModel {
  return { state: "IDLE", progress: 0, polls: 0, message: "Ready to scan a receipt." };
}

export function beginReceiptUpload(file: { readonly size: number; readonly type: string }): ReceiptScanModel {
  if (!RECEIPT_MIME_TYPES.includes(file.type)) {
    return { ...initialReceiptScan(), state: "FAILED", message: "Only JPEG, PNG or WebP images are supported." };
  }
  if (file.size <= 0 || file.size > RECEIPT_MAX_BYTES) {
    return { ...initialReceiptScan(), state: "FAILED", message: "The image must be smaller than 10 MB." };
  }
  return { ...initialReceiptScan(), state: "UPLOADING", message: "Uploading the receipt." };
}

export function receiptUploaded(model: ReceiptScanModel, jobId: string): ReceiptScanModel {
  return { ...model, state: "PROCESSING", jobId, message: "Reading the receipt." };
}

export function resolveReceiptJob(model: ReceiptScanModel, job: ReceiptJobSnapshot): ReceiptScanModel {
  const progress = Math.max(model.progress, Math.min(100, Math.max(0, job.progress)));
  if (job.status === "completed" || job.status === "needs_review") {
    if (job.draftId === null) {
      return { ...model, state: "MANUAL_REQUIRED", progress, message: "No draft was produced. Review manually." };
    }
    return { ...model, state: "PROCESSING", progress: 100, draftId: job.draftId, message: "Loading the draft." };
  }
  if (job.status === "failed" || job.status === "cancelled") {
    return { ...model, state: "FAILED", progress, message: "The receipt could not be read." };
  }
  const polls = model.polls + 1;
  if (polls >= RECEIPT_MAX_POLLS) {
    return { ...model, state: "MANUAL_REQUIRED", progress, polls, message: "Reading is taking too long. Review manually." };
  }
  return { ...model, state: "PROCESSING", progress, polls, message: "Reading the receipt." };
}

export function resolveReceiptDraft(model: ReceiptScanModel, itemCount: number): ReceiptScanModel {
  if (itemCount <= 0) {
    return { ...model, state: "MANUAL_REQUIRED", message: "No products were recognised. Review manually." };
  }
  return { ...model, state: "READY", message: `${itemCount} product${itemCount === 1 ? "" : "s"} recognised.` };
}

export function failReceiptScan(model: ReceiptScanModel, kind: "OFFLINE" | "ERROR"): ReceiptScanModel {
  return kind === "OFFLINE"
    ? { ...model, state: "OFFLINE", message: "You are offline. Review manually or retry later." }
    : { ...model, state: "FAILED", message: "The receipt could not be processed." };
}

export function shouldKeepPolling(model: ReceiptScanModel): boolean {
  return model.state === "PROCESSING" && model.draftId === undefined;
}

/** States after which the person can continue to the review step. */
export function isReceiptScanSettled(model: ReceiptScanModel): boolean {
  return model.state === "READY" || model.state === "MANUAL_REQUIRED" || model.state === "FAILED" || model.state === "OFFLINE";
}
