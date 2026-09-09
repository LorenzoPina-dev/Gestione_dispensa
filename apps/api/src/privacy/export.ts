import { authorize, type MembershipContext } from "../identity/authorization.js";
import type { Principal } from "../identity/oidc.js";

export interface ExportJob {
  readonly id: string;
  readonly familyId: string;
  readonly ownerId: string;
  readonly idempotencyKey: string;
  readonly status: "PENDING" | "COMPLETED" | "FAILED" | "EXPIRED";
  readonly artifactId?: string;
  readonly expiresAt?: number;
  readonly createdAt: number;
}

export interface PrivacyExportRepository {
  createOrGetExport(input: {
    readonly familyId: string;
    readonly ownerId: string;
    readonly idempotencyKey: string;
    readonly now: number;
  }): Promise<{ readonly job: ExportJob; readonly created: boolean }>;
  getExport(id: string): Promise<ExportJob | undefined>;
  completeExport(input: {
    readonly id: string;
    readonly artifactId: string;
    readonly expiresAt: number;
  }): Promise<ExportJob>;
}

export interface FamilyOwnershipReader {
  getMembership(familyId: string, userId: string): Promise<MembershipContext | undefined>;
}

export interface ExportJobPublisher {
  publish(input: {
    readonly jobId: string;
    readonly familyId: string;
    readonly capability: "privacy.export";
    readonly traceId: string;
  }): Promise<void>;
}

export interface PrivacyExportSource {
  collectFamilyExport(familyId: string): Promise<Readonly<Record<string, unknown>>>;
}

export interface ExportArtifactStore {
  put(input: {
    readonly artifactId: string;
    readonly familyId: string;
    readonly content: Readonly<Record<string, unknown>>;
    readonly expiresAt: number;
  }): Promise<void>;
  read(input: { readonly artifactId: string; readonly familyId: string }): Promise<{
    readonly artifactId: string;
    readonly familyId: string;
    readonly content: Readonly<Record<string, unknown>>;
    readonly expiresAt: number;
  }>;
}

export interface PrivacyAuditWriter {
  append(input: {
    readonly actorId: string;
    readonly action: "privacy.export.create" | "privacy.export.download";
    readonly resourceId: string;
    readonly familyId: string;
    readonly outcome: "SUCCESS" | "DENIED" | "FAILED";
    readonly traceId: string;
    readonly reason?: string;
  }): Promise<void>;
}

export class PrivacyExportError extends Error {
  public readonly code:
    | "UNAUTHENTICATED"
    | "FORBIDDEN"
    | "NOT_FOUND_OR_NOT_VISIBLE"
    | "EXPORT_EXPIRED"
    | "EXPORT_FAILED";

  public constructor(code: PrivacyExportError["code"], message: string) {
    super(message);
    this.name = "PrivacyExportError";
    this.code = code;
  }
}

export class PrivacyExportService {
  private readonly repository: PrivacyExportRepository;
  private readonly ownership: FamilyOwnershipReader;
  private readonly publisher: ExportJobPublisher;
  private readonly artifacts: ExportArtifactStore;
  private readonly audit: PrivacyAuditWriter;
  private readonly now: () => number;

  public constructor(
    repository: PrivacyExportRepository,
    ownership: FamilyOwnershipReader,
    publisher: ExportJobPublisher,
    artifacts: ExportArtifactStore,
    audit: PrivacyAuditWriter,
    now: () => number,
  ) {
    this.repository = repository;
    this.ownership = ownership;
    this.publisher = publisher;
    this.artifacts = artifacts;
    this.audit = audit;
    this.now = now;
  }

  public async create(
    principal: Principal | undefined,
    familyId: string,
    idempotencyKey: string,
    traceId: string,
  ): Promise<ExportJob> {
    const actor = await this.requireOwner(principal, familyId, traceId, "privacy.export.create");
    if (!idempotencyKey.trim()) {
      throw new PrivacyExportError("EXPORT_FAILED", "Idempotency-Key is required.");
    }

    try {
      const result = await this.repository.createOrGetExport({
        familyId,
        ownerId: actor.subject,
        idempotencyKey: idempotencyKey.trim(),
        now: this.now(),
      });
      if (result.created && result.job.status === "PENDING") {
        await this.publisher.publish({
          jobId: result.job.id,
          familyId,
          capability: "privacy.export",
          traceId,
        });
      }
      await this.audit.append({
        actorId: actor.subject,
        action: "privacy.export.create",
        resourceId: result.job.id,
        familyId,
        outcome: "SUCCESS",
        traceId,
      });
      return result.job;
    } catch (error) {
      await this.audit.append({
        actorId: actor.subject,
        action: "privacy.export.create",
        resourceId: familyId,
        familyId,
        outcome: "FAILED",
        traceId,
        reason: error instanceof Error ? error.message : "EXPORT_FAILED",
      });
      throw new PrivacyExportError("EXPORT_FAILED", "The export could not be created.");
    }
  }

  public async download(
    principal: Principal | undefined,
    exportId: string,
    traceId: string,
  ): Promise<{
    readonly artifactId: string;
    readonly familyId: string;
    readonly content: Readonly<Record<string, unknown>>;
    readonly expiresAt: number;
  }> {
    if (principal === undefined) {
      throw new PrivacyExportError("UNAUTHENTICATED", "Authentication is required.");
    }
    const job = await this.repository.getExport(exportId);
    if (job === undefined) {
      throw new PrivacyExportError("NOT_FOUND_OR_NOT_VISIBLE", "Export is not visible.");
    }
    const decision = authorize({ principal, action: "owner", resourceOwnerId: job.ownerId });
    if (!decision.allowed) {
      await this.audit.append({
        actorId: principal.subject,
        action: "privacy.export.download",
        resourceId: exportId,
        familyId: job.familyId,
        outcome: "DENIED",
        traceId,
        reason: decision.code,
      });
      throw new PrivacyExportError("FORBIDDEN", "Only the export owner may download it.");
    }
    if (job.status !== "COMPLETED" || job.artifactId === undefined || job.expiresAt === undefined) {
      throw new PrivacyExportError("NOT_FOUND_OR_NOT_VISIBLE", "Export artifact is not available.");
    }
    if (job.expiresAt <= this.now()) {
      throw new PrivacyExportError("EXPORT_EXPIRED", "Export artifact has expired.");
    }

    const artifact = await this.artifacts.read({
      artifactId: job.artifactId,
      familyId: job.familyId,
    });
    await this.audit.append({
      actorId: principal.subject,
      action: "privacy.export.download",
      resourceId: exportId,
      familyId: job.familyId,
      outcome: "SUCCESS",
      traceId,
    });
    return artifact;
  }

  private async requireOwner(
    principal: Principal | undefined,
    familyId: string,
    traceId: string,
    action: "privacy.export.create" | "privacy.export.download",
  ): Promise<Principal> {
    if (principal === undefined) {
      throw new PrivacyExportError("UNAUTHENTICATED", "Authentication is required.");
    }
    const membership = await this.ownership.getMembership(familyId, principal.subject);
    const isOwner =
      membership?.status === "ACTIVE" &&
      (membership.role === "CREATOR" || membership.role === "OWNER");
    const decision = authorize({
      principal,
      action: "owner",
      resourceOwnerId: principal.subject,
    });
    if (decision.allowed && isOwner) return principal;
    await this.audit.append({
      actorId: principal.subject,
      action,
      resourceId: familyId,
      familyId,
      outcome: "DENIED",
      traceId,
      reason: decision.code,
    });
    throw new PrivacyExportError("FORBIDDEN", "Family owner authorization is required.");
  }
}

export class PrivacyExportWorker {
  private readonly repository: PrivacyExportRepository;
  private readonly source: PrivacyExportSource;
  private readonly artifacts: ExportArtifactStore;
  private readonly ids: () => string;
  private readonly now: () => number;
  private readonly ttlMs: number;

  public constructor(
    repository: PrivacyExportRepository,
    source: PrivacyExportSource,
    artifacts: ExportArtifactStore,
    ids: () => string,
    now: () => number,
    ttlMs = 86_400_000,
  ) {
    this.repository = repository;
    this.source = source;
    this.artifacts = artifacts;
    this.ids = ids;
    this.now = now;
    this.ttlMs = ttlMs;
  }

  public async process(jobId: string): Promise<ExportJob> {
    const job = await this.repository.getExport(jobId);
    if (job === undefined)
      throw new PrivacyExportError("NOT_FOUND_OR_NOT_VISIBLE", "Export is not visible.");
    if (job.status !== "PENDING") return job;
    const expiresAt = this.now() + this.ttlMs;
    const artifactId = this.ids();
    const content = await this.source.collectFamilyExport(job.familyId);
    await this.artifacts.put({ artifactId, familyId: job.familyId, content, expiresAt });
    return this.repository.completeExport({ id: job.id, artifactId, expiresAt });
  }
}
