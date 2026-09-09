import { RecognitionPipeline, type RecognitionResult, type UploadInput } from "./recognition.js";

export interface RecognitionRuntimeRepository {
  getResult(jobId: string): Promise<RecognitionResult | undefined>;
  saveResult(input: {
    readonly jobId: string;
    readonly upload: UploadInput;
    readonly result: RecognitionResult;
  }): Promise<void>;
  confirmCandidate(input: {
    readonly operationId: string;
    readonly actorId: string;
    readonly jobId: string;
    readonly candidateIndex: number;
    readonly traceId: string;
  }): Promise<void>;
}

export interface QuarantineObjectStore {
  put(input: { readonly objectKey: string; readonly upload: UploadInput }): Promise<void>;
}

export class RecognitionRuntimeService {
  public constructor(
    private readonly pipeline: RecognitionPipeline,
    private readonly repository: RecognitionRuntimeRepository,
    private readonly quarantine: QuarantineObjectStore,
  ) {}

  public async process(input: {
    readonly jobId: string;
    readonly objectKey: string;
    readonly upload: UploadInput;
    readonly traceId: string;
  }): Promise<RecognitionResult> {
    const existing = await this.repository.getResult(input.jobId);
    if (existing !== undefined) return existing;

    await this.quarantine.put({ objectKey: input.objectKey, upload: input.upload });
    const result = await this.pipeline.process(input.upload, input.traceId);
    await this.repository.saveResult({
      jobId: input.jobId,
      upload: input.upload,
      result,
    });
    return result;
  }

  public async confirm(input: {
    readonly operationId: string;
    readonly actorId: string;
    readonly jobId: string;
    readonly candidateIndex: number;
    readonly traceId: string;
  }): Promise<void> {
    if (!Number.isSafeInteger(input.candidateIndex) || input.candidateIndex < 0) {
      throw new Error("Candidate index must be a non-negative integer.");
    }
    await this.repository.confirmCandidate(input);
  }
}
