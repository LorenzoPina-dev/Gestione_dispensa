/**
 * receipt-ocr-queue pipeline: turns an uploaded receipt image/PDF into structured line items,
 * mirroring recognition.ts's shape (validate -> call provider with a timeout -> normalize
 * result) for the same reasons -- a slow/unavailable third-party OCR provider must never hang a
 * worker forever, and a low-confidence/empty result must degrade to a reviewable state rather
 * than silently doing nothing.
 */
export interface ReceiptOcrLineItem {
  readonly rawDescription: string;
  readonly quantity: number;
  readonly unitPrice?: number;
  readonly totalPrice: number;
  readonly matchConfidence?: number;
}

export interface ReceiptOcrExtraction {
  readonly storeName?: string;
  readonly purchasedAt?: string; // ISO 8601
  readonly totalAmount?: number;
  readonly currency?: string;
  readonly lineItems: readonly ReceiptOcrLineItem[];
}

export interface OcrProviderContext {
  readonly traceId: string;
  readonly signal: AbortSignal;
}

export interface ReceiptOcrProvider {
  extract(
    input: { readonly objectKey: string; readonly mimeType: string },
    context: OcrProviderContext,
  ): Promise<ReceiptOcrExtraction>;
}

export type ReceiptOcrOutcome =
  | ({ readonly status: "PARSED" } & ReceiptOcrExtraction)
  | { readonly status: "MANUAL_REQUIRED"; readonly reason: "NO_ITEMS_DETECTED" }
  | { readonly status: "DEGRADED"; readonly reason: "PROVIDER_TIMEOUT" | "PROVIDER_ERROR" };

export interface ReceiptOcrPipelineOptions {
  readonly provider: ReceiptOcrProvider;
  readonly timeoutMs: number;
}

export class ReceiptOcrPipeline {
  private readonly options: ReceiptOcrPipelineOptions;

  public constructor(options: ReceiptOcrPipelineOptions) {
    if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1) {
      throw new Error("Receipt OCR pipeline timeout is invalid.");
    }
    this.options = options;
  }

  public async process(
    input: { readonly objectKey: string; readonly mimeType: string },
    traceId: string,
  ): Promise<ReceiptOcrOutcome> {
    if (traceId.trim().length < 16) throw new Error("Receipt OCR requires a traceId.");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const extraction = await Promise.race([
        this.options.provider.extract(input, { traceId, signal: controller.signal }),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("provider timeout")), this.options.timeoutMs);
        }),
      ]);
      const lineItems = extraction.lineItems.filter(
        (item) => item.rawDescription.trim().length > 0 && Number.isFinite(item.totalPrice),
      );
      if (lineItems.length === 0) {
        return { status: "MANUAL_REQUIRED", reason: "NO_ITEMS_DETECTED" };
      }
      return { status: "PARSED", ...extraction, lineItems };
    } catch (error: unknown) {
      if (controller.signal.aborted || (error instanceof Error && error.message === "provider timeout")) {
        return { status: "DEGRADED", reason: "PROVIDER_TIMEOUT" };
      }
      return { status: "DEGRADED", reason: "PROVIDER_ERROR" };
    } finally {
      clearTimeout(timeout);
    }
  }
}
