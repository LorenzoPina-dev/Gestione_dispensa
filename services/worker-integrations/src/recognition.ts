export type UploadMimeType = "image/jpeg" | "image/png";
export type RecognitionState = "PENDING_REVIEW" | "MANUAL_REQUIRED" | "DEGRADED";

export interface UploadInput {
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

export interface QuarantineScanner {
  scan(input: UploadInput): Promise<"CLEAN" | "MALWARE" | "UNAVAILABLE">;
}

export interface RecognitionProviderContext {
  readonly traceId: string;
  readonly signal: AbortSignal;
}

export interface RecognitionCandidate {
  readonly name: string;
  readonly confidence: number;
  readonly source: string;
}

export interface RecognitionProvider {
  recognize(
    sanitizedUpload: UploadInput,
    context: RecognitionProviderContext,
  ): Promise<{
    readonly providerRequestId: string;
    readonly candidates: readonly RecognitionCandidate[];
  }>;
}

export interface RecognitionResult {
  readonly state: RecognitionState;
  readonly candidates?: readonly RecognitionCandidate[];
  readonly reason?:
    "UNSUPPORTED_MEDIA" | "UPLOAD_TOO_LARGE" | "MALWARE" | "SCAN_UNAVAILABLE" | "PROVIDER_TIMEOUT";
  readonly reviewRequired: true;
}

export interface RecognitionPipelineOptions {
  readonly scanner: QuarantineScanner;
  readonly provider: RecognitionProvider;
  readonly maxUploadBytes: number;
  readonly timeoutMs: number;
  readonly lowConfidenceThreshold: number;
}

export class RecognitionPipeline {
  private readonly options: RecognitionPipelineOptions;

  public constructor(options: RecognitionPipelineOptions) {
    if (
      !Number.isInteger(options.maxUploadBytes) ||
      options.maxUploadBytes < 1 ||
      !Number.isInteger(options.timeoutMs) ||
      options.timeoutMs < 1 ||
      options.lowConfidenceThreshold < 0 ||
      options.lowConfidenceThreshold > 1
    ) {
      throw new Error("Recognition pipeline limits are invalid.");
    }
    this.options = options;
  }

  public async process(upload: UploadInput, traceId: string): Promise<RecognitionResult> {
    const validation = validateUpload(upload, this.options.maxUploadBytes);
    if (validation !== undefined) {
      return { state: "MANUAL_REQUIRED", reason: validation, reviewRequired: true };
    }
    if (traceId.trim().length < 16) {
      throw new Error("Recognition requires a traceId.");
    }

    const scan = await this.options.scanner.scan(upload);
    if (scan === "MALWARE") {
      return { state: "MANUAL_REQUIRED", reason: "MALWARE", reviewRequired: true };
    }
    if (scan === "UNAVAILABLE") {
      return { state: "DEGRADED", reason: "SCAN_UNAVAILABLE", reviewRequired: true };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await Promise.race([
        this.options.provider.recognize(upload, { traceId, signal: controller.signal }),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("provider timeout")), this.options.timeoutMs);
        }),
      ]);
      const candidates = response.candidates.filter(
        (candidate) =>
          candidate.name.trim().length > 0 &&
          Number.isFinite(candidate.confidence) &&
          candidate.confidence >= 0 &&
          candidate.confidence <= 1,
      );
      if (candidates.length === 0) {
        return { state: "MANUAL_REQUIRED", reviewRequired: true };
      }
      return {
        state: "PENDING_REVIEW",
        candidates,
        reviewRequired: true,
      };
    } catch (error: unknown) {
      if (
        controller.signal.aborted ||
        (error instanceof Error && error.message === "provider timeout")
      ) {
        return { state: "DEGRADED", reason: "PROVIDER_TIMEOUT", reviewRequired: true };
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function validateUpload(
  upload: UploadInput,
  maxUploadBytes: number,
): RecognitionResult["reason"] | undefined {
  if (!["image/jpeg", "image/png"].includes(upload.mimeType)) {
    return "UNSUPPORTED_MEDIA";
  }
  if (
    !Number.isSafeInteger(upload.sizeBytes) ||
    upload.sizeBytes < 1 ||
    upload.sizeBytes > maxUploadBytes
  ) {
    return "UPLOAD_TOO_LARGE";
  }
  if (upload.filename.trim().length === 0 || upload.filename.includes("..")) {
    return "UNSUPPORTED_MEDIA";
  }
  return undefined;
}
