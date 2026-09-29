import { JobError, type JobHandler } from "@gestione-dispensa/worker-core";
import { ReceiptOcrPipeline, type ReceiptOcrExtraction } from "./receipt-ocr.js";

export interface PendingReceipt {
  readonly familyId: string;
  readonly objectKey: string;
  readonly mimeType: string;
}

export interface ReceiptOcrRepository {
  /**
   * Idempotent: returns undefined (a no-op for the runtime service, see process() below) if the
   * receipt is missing or already past PENDING/PROCESSING -- so a job retried after a crash
   * between "mark processing" and "commit result" never reprocesses a receipt twice.
   */
  markProcessing(receiptId: string): Promise<PendingReceipt | undefined>;
  saveParsed(receiptId: string, extraction: ReceiptOcrExtraction): Promise<void>;
  markManualRequired(receiptId: string, reason: string): Promise<void>;
  markFailed(receiptId: string, reason: string): Promise<void>;
}

export class ReceiptOcrRuntimeService {
  public constructor(
    private readonly pipeline: ReceiptOcrPipeline,
    private readonly repository: ReceiptOcrRepository,
  ) {}

  public async process(input: { readonly receiptId: string; readonly traceId: string }): Promise<void> {
    const receipt = await this.repository.markProcessing(input.receiptId);
    if (receipt === undefined) return; // already handled, or genuinely gone -- nothing to do
    try {
      const outcome = await this.pipeline.process(
        { objectKey: receipt.objectKey, mimeType: receipt.mimeType },
        input.traceId,
      );
      if (outcome.status === "PARSED") {
        await this.repository.saveParsed(input.receiptId, outcome);
        return;
      }
      if (outcome.status === "MANUAL_REQUIRED") {
        await this.repository.markManualRequired(input.receiptId, outcome.reason);
        return;
      }
      // DEGRADED (provider timeout/error): classified TRANSIENT below so JobWorker retries with
      // backoff instead of leaving the receipt stuck; markFailed only records the LAST reason.
      await this.repository.markFailed(input.receiptId, outcome.reason);
      throw new JobError("RECEIPT_OCR_DEGRADED", "TRANSIENT", `Receipt OCR degraded: ${outcome.reason}`);
    } catch (error) {
      if (error instanceof JobError) throw error;
      await this.repository.markFailed(
        input.receiptId,
        error instanceof Error ? error.message : "UNKNOWN_FAILURE",
      );
      throw new JobError(
        "RECEIPT_OCR_FAILED",
        "TRANSIENT",
        error instanceof Error ? error.message : "Receipt OCR failed.",
      );
    }
  }
}

export function receiptOcrHandler(runtime: ReceiptOcrRuntimeService): JobHandler {
  return async ({ job }) => {
    const receiptId = job.payload.receiptId;
    if (typeof receiptId !== "string" || receiptId.trim().length === 0) {
      throw new JobError("INVALID_RECEIPT_OCR_JOB", "PERMANENT", "receiptId is required.");
    }
    await runtime.process({ receiptId, traceId: job.traceId ?? job.id });
    return { receiptId };
  };
}
