import { authorize, type MembershipContext } from "../identity/authorization.js";
import type { Principal } from "../identity/oidc.js";

export type ErasureStatus = "REQUESTED" | "PROCESSING" | "COMPLETED" | "FAILED";

export interface ErasureRequest {
  readonly id: string;
  readonly familyId: string;
  readonly requesterId: string;
  readonly idempotencyKey: string;
  readonly status: ErasureStatus;
  readonly createdAt: number;
  readonly completedAt?: number;
}

export interface PrivacyConsent {
  readonly userId: string;
  readonly purpose: string;
  readonly granted: boolean;
  readonly consentVersion: string;
  readonly updatedAt: number;
}

export interface PrivacyErasureRepository {
  createOrGetErasure(input: {
    readonly familyId: string;
    readonly requesterId: string;
    readonly idempotencyKey: string;
    readonly now: number;
  }): Promise<{ readonly request: ErasureRequest; readonly created: boolean }>;
  getErasure(id: string): Promise<ErasureRequest | undefined>;
  markProcessing(id: string): Promise<ErasureRequest>;
  completeErasure(id: string, completedAt: number): Promise<ErasureRequest>;
  failErasure(id: string): Promise<ErasureRequest>;
  upsertConsent(input: PrivacyConsent): Promise<PrivacyConsent>;
  listConsents(userId: string): Promise<readonly PrivacyConsent[]>;
}

export interface FamilyOwnershipReader {
  getMembership(familyId: string, userId: string): Promise<MembershipContext | undefined>;
}

export interface ErasureJobPublisher {
  publish(input: {
    readonly jobId: string;
    readonly familyId: string;
    readonly capability: "privacy.erasure";
    readonly traceId: string;
  }): Promise<void>;
}

export interface PrivacyErasureExecutor {
  anonymizeFamily(input: {
    readonly familyId: string;
    readonly requesterId: string;
    readonly preserveLegalRecords: boolean;
  }): Promise<void>;
}

export interface PrivacyAuditWriter {
  append(input: {
    readonly actorId: string;
    readonly action:
      "privacy.erasure.create" | "privacy.erasure.process" | "privacy.consent.update";
    readonly resourceId: string;
    readonly familyId?: string;
    readonly outcome: "SUCCESS" | "DENIED" | "FAILED";
    readonly traceId: string;
    readonly reason?: string;
  }): Promise<void>;
}

export class PrivacyErasureError extends Error {
  public readonly code:
    | "UNAUTHENTICATED"
    | "FORBIDDEN"
    | "NOT_FOUND_OR_NOT_VISIBLE"
    | "CONFIRMATION_REQUIRED"
    | "INVALID_CONSENT"
    | "ERASURE_FAILED";

  public constructor(code: PrivacyErasureError["code"], message: string) {
    super(message);
    this.name = "PrivacyErasureError";
    this.code = code;
  }
}

export class PrivacyErasureService {
  private readonly repository: PrivacyErasureRepository;
  private readonly ownership: FamilyOwnershipReader;
  private readonly publisher: ErasureJobPublisher;
  private readonly audit: PrivacyAuditWriter;
  private readonly now: () => number;

  public constructor(
    repository: PrivacyErasureRepository,
    ownership: FamilyOwnershipReader,
    publisher: ErasureJobPublisher,
    audit: PrivacyAuditWriter,
    now: () => number,
  ) {
    this.repository = repository;
    this.ownership = ownership;
    this.publisher = publisher;
    this.audit = audit;
    this.now = now;
  }

  public async request(
    principal: Principal | undefined,
    familyId: string,
    confirmed: boolean,
    idempotencyKey: string,
    traceId: string,
  ): Promise<ErasureRequest> {
    const actor = await this.requireOwner(principal, familyId, traceId);
    if (!confirmed) {
      throw new PrivacyErasureError(
        "CONFIRMATION_REQUIRED",
        "Explicit erasure confirmation is required.",
      );
    }
    if (!idempotencyKey.trim()) {
      throw new PrivacyErasureError("ERASURE_FAILED", "Idempotency-Key is required.");
    }

    try {
      const result = await this.repository.createOrGetErasure({
        familyId,
        requesterId: actor.subject,
        idempotencyKey: idempotencyKey.trim(),
        now: this.now(),
      });
      if (result.created && result.request.status === "REQUESTED") {
        await this.publisher.publish({
          jobId: result.request.id,
          familyId,
          capability: "privacy.erasure",
          traceId,
        });
      }
      await this.audit.append({
        actorId: actor.subject,
        action: "privacy.erasure.create",
        resourceId: result.request.id,
        familyId,
        outcome: "SUCCESS",
        traceId,
      });
      return result.request;
    } catch (error) {
      await this.audit.append({
        actorId: actor.subject,
        action: "privacy.erasure.create",
        resourceId: familyId,
        familyId,
        outcome: "FAILED",
        traceId,
        reason: error instanceof Error ? error.message : "ERASURE_FAILED",
      });
      throw new PrivacyErasureError("ERASURE_FAILED", "The erasure request could not be created.");
    }
  }

  public async updateConsent(
    principal: Principal | undefined,
    purpose: string,
    granted: boolean,
    consentVersion: string,
    traceId: string,
  ): Promise<PrivacyConsent> {
    const actor = this.requireAuthenticated(principal);
    const normalizedPurpose = purpose.trim();
    const normalizedVersion = consentVersion.trim();
    if (
      normalizedPurpose.length < 1 ||
      normalizedPurpose.length > 100 ||
      normalizedVersion.length < 1 ||
      normalizedVersion.length > 64
    ) {
      throw new PrivacyErasureError("INVALID_CONSENT", "Consent purpose and version are invalid.");
    }
    try {
      const consent = await this.repository.upsertConsent({
        userId: actor.subject,
        purpose: normalizedPurpose,
        granted,
        consentVersion: normalizedVersion,
        updatedAt: this.now(),
      });
      await this.audit.append({
        actorId: actor.subject,
        action: "privacy.consent.update",
        resourceId: normalizedPurpose,
        outcome: "SUCCESS",
        traceId,
      });
      return consent;
    } catch (error) {
      await this.audit.append({
        actorId: actor.subject,
        action: "privacy.consent.update",
        resourceId: normalizedPurpose,
        outcome: "FAILED",
        traceId,
        reason: error instanceof Error ? error.message : "INVALID_CONSENT",
      });
      throw new PrivacyErasureError("INVALID_CONSENT", "The consent could not be stored.");
    }
  }

  public async listConsents(principal: Principal | undefined): Promise<readonly PrivacyConsent[]> {
    return this.repository.listConsents(this.requireAuthenticated(principal).subject);
  }

  private async requireOwner(
    principal: Principal | undefined,
    familyId: string,
    traceId: string,
  ): Promise<Principal> {
    const actor = this.requireAuthenticated(principal);
    const membership = await this.ownership.getMembership(familyId, actor.subject);
    const isOwner =
      membership?.status === "ACTIVE" &&
      (membership.role === "OWNER" || membership.role === "CREATOR");
    const decision = authorize({
      principal: actor,
      action: "owner",
      resourceOwnerId: actor.subject,
    });
    if (decision.allowed && isOwner) return actor;
    await this.audit.append({
      actorId: actor.subject,
      action: "privacy.erasure.create",
      resourceId: familyId,
      familyId,
      outcome: "DENIED",
      traceId,
      reason: decision.code,
    });
    throw new PrivacyErasureError("FORBIDDEN", "Family owner authorization is required.");
  }

  private requireAuthenticated(principal: Principal | undefined): Principal {
    if (principal === undefined) {
      throw new PrivacyErasureError("UNAUTHENTICATED", "Authentication is required.");
    }
    return principal;
  }
}

export class PrivacyErasureWorker {
  private readonly repository: PrivacyErasureRepository;
  private readonly executor: PrivacyErasureExecutor;
  private readonly audit: PrivacyAuditWriter;
  private readonly now: () => number;

  public constructor(
    repository: PrivacyErasureRepository,
    executor: PrivacyErasureExecutor,
    audit: PrivacyAuditWriter,
    now: () => number,
  ) {
    this.repository = repository;
    this.executor = executor;
    this.audit = audit;
    this.now = now;
  }

  public async process(requestId: string, traceId: string): Promise<ErasureRequest> {
    const request = await this.repository.getErasure(requestId);
    if (request === undefined) {
      throw new PrivacyErasureError("NOT_FOUND_OR_NOT_VISIBLE", "Erasure request is not visible.");
    }
    if (request.status === "COMPLETED") return request;
    const processing = await this.repository.markProcessing(requestId);
    try {
      await this.executor.anonymizeFamily({
        familyId: processing.familyId,
        requesterId: processing.requesterId,
        preserveLegalRecords: true,
      });
      const completed = await this.repository.completeErasure(requestId, this.now());
      await this.audit.append({
        actorId: processing.requesterId,
        action: "privacy.erasure.process",
        resourceId: requestId,
        familyId: processing.familyId,
        outcome: "SUCCESS",
        traceId,
      });
      return completed;
    } catch (error) {
      await this.repository.failErasure(requestId);
      await this.audit.append({
        actorId: processing.requesterId,
        action: "privacy.erasure.process",
        resourceId: requestId,
        familyId: processing.familyId,
        outcome: "FAILED",
        traceId,
        reason: error instanceof Error ? error.message : "ERASURE_FAILED",
      });
      throw new PrivacyErasureError("ERASURE_FAILED", "The erasure could not be completed.");
    }
  }
}
