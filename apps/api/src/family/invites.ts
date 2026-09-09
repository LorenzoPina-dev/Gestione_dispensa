import { createHash, randomBytes } from "node:crypto";

export type InviteRole = "MANAGER" | "MEMBER" | "VIEWER";
export type InviteStatus = "CREATED" | "REVOKED" | "CONSUMED" | "EXPIRED";
export type JoinAttemptState =
  "PENDING_AUTHENTICATION" | "PENDING_REVIEW" | "ACCEPTED" | "REJECTED" | "EXPIRED";

export interface InviteClock {
  now(): Date;
}

export interface InviteIdGenerator {
  next(): string;
}

export interface InviteTokenGenerator {
  token(): string;
  fallbackCode(): string;
}

export interface FamilyInviteRecord {
  id: string;
  familyId: string;
  createdBy: string;
  role: InviteRole;
  tokenHash: string;
  fallbackCodeHash: string;
  status: InviteStatus;
  expiresAt: Date;
  consumedAt: Date | undefined;
  revokedAt: Date | undefined;
  createdAt: Date;
}

export interface CreatedInvite {
  inviteId: string;
  role: InviteRole;
  status: "CREATED";
  expiresAt: Date;
  qrPayload: string;
  fallbackCode: string;
}

export interface JoinAttempt {
  id: string;
  inviteId: string;
  userId: string | undefined;
  browserBindingHash: string;
  state: JoinAttemptState;
  expiresAt: Date;
  traceId: string;
}

export interface InviteRepository {
  createInvite(record: FamilyInviteRecord): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<FamilyInviteRecord | undefined>;
  createJoinAttempt(attempt: JoinAttempt): Promise<void>;
  getJoinAttempt(id: string): Promise<JoinAttempt | undefined>;
  markExpired(inviteId: string, now: Date): Promise<void>;
  revoke(inviteId: string, actorId: string, now: Date): Promise<void>;
  acceptAtomically(input: {
    attemptId: string;
    userId: string;
    now: Date;
    consentVersion: string;
  }): Promise<JoinAttempt>;
}

export class InviteUnavailableError extends Error {
  public readonly code = "INVITE_UNAVAILABLE";

  public constructor() {
    super("The invitation is unavailable.");
    this.name = "InviteUnavailableError";
  }
}

export class InviteService {
  private readonly repository: InviteRepository;
  private readonly ids: InviteIdGenerator;
  private readonly clock: InviteClock;
  private readonly tokens: InviteTokenGenerator;

  public constructor(
    repository: InviteRepository,
    ids: InviteIdGenerator,
    clock: InviteClock,
    tokens: InviteTokenGenerator = new SecureInviteTokenGenerator(),
  ) {
    this.repository = repository;
    this.ids = ids;
    this.clock = clock;
    this.tokens = tokens;
  }

  public async createInvite(input: {
    familyId: string;
    actorId: string;
    role: InviteRole;
    expiresInSeconds: number;
  }): Promise<CreatedInvite> {
    if (input.expiresInSeconds < 60 || input.expiresInSeconds > 86_400) {
      throw new Error("Invite expiry must be between 60 and 86400 seconds.");
    }
    const now = this.clock.now();
    const token = this.tokens.token();
    const fallbackCode = this.tokens.fallbackCode();
    const inviteId = this.ids.next();
    const expiresAt = new Date(now.getTime() + input.expiresInSeconds * 1000);
    await this.repository.createInvite({
      id: inviteId,
      familyId: input.familyId,
      createdBy: input.actorId,
      role: input.role,
      tokenHash: hashSecret(token),
      fallbackCodeHash: hashSecret(fallbackCode),
      status: "CREATED",
      expiresAt,
      consumedAt: undefined,
      revokedAt: undefined,
      createdAt: now,
    });
    return {
      inviteId,
      role: input.role,
      status: "CREATED",
      expiresAt,
      qrPayload: token,
      fallbackCode,
    };
  }

  public async resolve(
    token: string,
    browserBindingHash: string,
    traceId: string,
  ): Promise<JoinAttempt> {
    const invite = await this.repository.findByTokenHash(hashSecret(token));
    const now = this.clock.now();
    if (invite === undefined || invite.status !== "CREATED") throw new InviteUnavailableError();
    if (invite.expiresAt <= now) {
      await this.repository.markExpired(invite.id, now);
      throw new InviteUnavailableError();
    }
    const attempt = {
      id: this.ids.next(),
      inviteId: invite.id,
      userId: undefined,
      browserBindingHash,
      state: "PENDING_AUTHENTICATION" as const,
      expiresAt: new Date(now.getTime() + 600_000),
      traceId,
    };
    await this.repository.createJoinAttempt(attempt);
    return attempt;
  }

  public async accept(
    attemptId: string,
    userId: string,
    consentVersion: string,
  ): Promise<JoinAttempt> {
    if (!consentVersion.trim()) throw new Error("Consent version is required.");
    return this.repository.acceptAtomically({
      attemptId,
      userId,
      now: this.clock.now(),
      consentVersion,
    });
  }
}

export class SecureInviteTokenGenerator implements InviteTokenGenerator {
  public token(): string {
    return `dispensa_invite_${randomBytes(32).toString("base64url")}`;
  }

  public fallbackCode(): string {
    return String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, "0");
  }
}

export function hashSecret(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
