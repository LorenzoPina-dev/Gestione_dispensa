import { authorize, type MembershipContext } from "../identity/authorization.js";
import type { Principal } from "../identity/oidc.js";
import { FamilyService, type CreateFamilyCommand } from "./service.js";
import { InviteService, InviteUnavailableError, type InviteRole } from "./invites.js";
import {
  MembershipConflictError,
  MembershipNotFoundError,
  MembershipService,
  MembershipValidationError,
  type ManagedMembership,
} from "./membership.js";

export interface FamilyMembershipReader {
  getMembership(familyId: string, userId: string): Promise<MembershipContext | undefined>;
}

/**
 * Lists the families a user belongs to. Separate from `FamilyMembershipReader` (a single
 * family/user lookup used for authorization) because this backs the "which families can I see"
 * bootstrap query the web client needs and has no prior use in this codebase.
 */
export interface UserFamiliesReader {
  listFamiliesForUser(
    userId: string,
  ): Promise<readonly { familyId: string; displayName: string; role: string }[]>;
}

export interface FamilyHttpMeta {
  requestId: string;
  traceId: string;
  schemaVersion: "1.0";
}

export interface FamilyHttpSuccess<T> {
  data: T;
  meta: FamilyHttpMeta;
}

export interface FamilyHttpFailure {
  error: { code: string; message: string; retryable: boolean };
  meta: FamilyHttpMeta;
}

export class FamilyHttpError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "FamilyHttpError";
  }
}

export class FamilyController {
  private readonly families: FamilyService;
  private readonly invites: InviteService;
  private readonly memberships: FamilyMembershipReader;
  private readonly membershipService: MembershipService | undefined;
  private readonly userFamilies: UserFamiliesReader | undefined;

  public constructor(
    families: FamilyService,
    invites: InviteService,
    memberships: FamilyMembershipReader,
    membershipService?: MembershipService,
    userFamilies?: UserFamiliesReader,
  ) {
    this.families = families;
    this.invites = invites;
    this.memberships = memberships;
    this.membershipService = membershipService;
    this.userFamilies = userFamilies;
  }

  public async createFamily(
    principal: Principal | undefined,
    command: Omit<CreateFamilyCommand, "creatorUserId">,
    meta: FamilyHttpMeta,
  ): Promise<FamilyHttpSuccess<unknown>> {
    if (principal === undefined)
      throw new FamilyHttpError(401, "UNAUTHENTICATED", "Authentication is required.");
    const result = await this.families.createFamily({
      ...command,
      creatorUserId: principal.subject,
    });
    return success({ family: result.family, membership: result.membership }, meta);
  }

  /** Backs `GET /api/v1/families` — the families the caller belongs to. */
  public async listFamilies(
    principal: Principal | undefined,
    meta: FamilyHttpMeta,
  ): Promise<FamilyHttpSuccess<{ families: readonly { familyId: string; displayName: string; role: string }[] }>> {
    if (principal === undefined)
      throw new FamilyHttpError(401, "UNAUTHENTICATED", "Authentication is required.");
    if (this.userFamilies === undefined) {
      throw new FamilyHttpError(501, "CAPABILITY_UNAVAILABLE", "Listing families is not available.");
    }
    const families = await this.userFamilies.listFamiliesForUser(principal.subject);
    return success({ families }, meta);
  }

  public async getFamily(
    principal: Principal | undefined, familyId: string, meta: FamilyHttpMeta,
  ): Promise<FamilyHttpSuccess<unknown>> {
    if (principal === undefined) throw new FamilyHttpError(401, "UNAUTHENTICATED", "Authentication is required.");
    await this.assertMember(principal, familyId, "family.read");
    const family = await this.families.getFamily(familyId);
    if (family === undefined) throw new FamilyHttpError(404, "NOT_FOUND_OR_NOT_VISIBLE", "Family is not visible.");
    return success({ family }, meta);
  }

  /** Backs `GET /api/v1/families/{familyId}/members`. Any active member may list members. */
  public async listMembers(
    principal: Principal | undefined,
    familyId: string,
    meta: FamilyHttpMeta,
  ): Promise<FamilyHttpSuccess<{ memberships: readonly ManagedMembership[] }>> {
    if (principal === undefined)
      throw new FamilyHttpError(401, "UNAUTHENTICATED", "Authentication is required.");
    await this.assertMember(principal, familyId, "family.read");
    if (this.membershipService === undefined) {
      throw new FamilyHttpError(501, "CAPABILITY_UNAVAILABLE", "Membership management is not available.");
    }
    const memberships = await this.membershipService.listMembers(familyId);
    return success({ memberships }, meta);
  }

  /** Backs `PATCH /api/v1/families/{familyId}/members/{membershipId}`. Admin-only (OWNER/MANAGER). */
  public async updateMembership(
    principal: Principal | undefined,
    familyId: string,
    membershipId: string,
    input: { role: string; status: string },
    meta: FamilyHttpMeta,
  ): Promise<FamilyHttpSuccess<ManagedMembership>> {
    if (principal === undefined)
      throw new FamilyHttpError(401, "UNAUTHENTICATED", "Authentication is required.");
    await this.assertMember(principal, familyId, "family.admin");
    if (this.membershipService === undefined) {
      throw new FamilyHttpError(501, "CAPABILITY_UNAVAILABLE", "Membership management is not available.");
    }
    try {
      const membership = await this.membershipService.updateMembership({
        familyId,
        membershipId,
        role: input.role,
        status: input.status,
      });
      return success(membership, meta);
    } catch (error) {
      throw toMembershipHttpError(error);
    }
  }

  /** Backs `DELETE /api/v1/families/{familyId}/members/{membershipId}`. Admin-only (OWNER/MANAGER). */
  public async removeMembership(
    principal: Principal | undefined,
    familyId: string,
    membershipId: string,
    meta: FamilyHttpMeta,
  ): Promise<FamilyHttpSuccess<ManagedMembership>> {
    if (principal === undefined)
      throw new FamilyHttpError(401, "UNAUTHENTICATED", "Authentication is required.");
    await this.assertMember(principal, familyId, "family.admin");
    if (this.membershipService === undefined) {
      throw new FamilyHttpError(501, "CAPABILITY_UNAVAILABLE", "Membership management is not available.");
    }
    try {
      const membership = await this.membershipService.removeMembership({
        familyId,
        membershipId,
        removedAt: new Date(),
      });
      return success(membership, meta);
    } catch (error) {
      throw toMembershipHttpError(error);
    }
  }

  public async listInvites(principal: Principal | undefined, familyId: string, meta: FamilyHttpMeta): Promise<FamilyHttpSuccess<{ invites: unknown[] }>> {
    if (principal === undefined) throw new FamilyHttpError(401, "UNAUTHENTICATED", "Authentication is required.");
    await this.assertMember(principal, familyId, "family.admin");
    const invites = await this.invites.list(familyId);
    return success({ invites: invites.map(({ tokenHash, fallbackCodeHash, ...safe }) => safe) }, meta);
  }

  public async revokeInvite(principal: Principal | undefined, familyId: string, inviteId: string, meta: FamilyHttpMeta): Promise<FamilyHttpSuccess<unknown>> {
    if (principal === undefined) throw new FamilyHttpError(401, "UNAUTHENTICATED", "Authentication is required.");
    await this.assertMember(principal, familyId, "family.admin");
    try { return success(await this.invites.revoke(familyId, inviteId), meta); }
    catch (error) { if (error instanceof InviteUnavailableError) throw new FamilyHttpError(404, "NOT_FOUND_OR_NOT_VISIBLE", "Invitation is unavailable."); throw error; }
  }

  public async reviewInvite(principal: Principal | undefined, attemptId: string, meta: FamilyHttpMeta): Promise<FamilyHttpSuccess<unknown>> {
    if (principal === undefined) throw new FamilyHttpError(401, "UNAUTHENTICATED", "Authentication is required.");
    const attempt = await this.invites.getJoinAttempt(attemptId);
    if (attempt === undefined || (attempt.userId !== undefined && attempt.userId !== principal.subject))
      throw new FamilyHttpError(404, "NOT_FOUND_OR_NOT_VISIBLE", "Invitation attempt is not visible.");
    return success({ attemptId: attempt.id, state: attempt.state, expiresAt: attempt.expiresAt, familyId: attempt.familyId, role: attempt.role }, meta);
  }

  public async rejectInvite(principal: Principal | undefined, attemptId: string, meta: FamilyHttpMeta): Promise<FamilyHttpSuccess<unknown>> {
    if (principal === undefined) throw new FamilyHttpError(401, "UNAUTHENTICATED", "Authentication is required.");
    try { return success(await this.invites.reject(attemptId, principal.subject), meta); }
    catch (error) { if (error instanceof InviteUnavailableError) throw new FamilyHttpError(404, "NOT_FOUND_OR_NOT_VISIBLE", "Invitation attempt is unavailable."); throw error; }
  }

  public async createInvite(
    principal: Principal | undefined,
    familyId: string,
    input: { role: InviteRole; expiresInSeconds: number },
    meta: FamilyHttpMeta,
  ): Promise<FamilyHttpSuccess<unknown>> {
    if (principal === undefined)
      throw new FamilyHttpError(401, "UNAUTHENTICATED", "Authentication is required.");
    await this.assertMember(principal, familyId, "family.admin");
    return success(
      await this.invites.createInvite({ ...input, familyId, actorId: principal.subject }),
      meta,
    );
  }

  public async resolveInvite(
    token: string,
    browserBindingHash: string,
    traceId: string,
    meta: FamilyHttpMeta,
  ): Promise<FamilyHttpSuccess<unknown>> {
    try {
      return success(await this.invites.resolve(token, browserBindingHash, traceId), meta);
    } catch (error) {
      if (error instanceof InviteUnavailableError)
        throw new FamilyHttpError(404, "NOT_FOUND_OR_NOT_VISIBLE", "Invitation is unavailable.");
      throw error;
    }
  }

  /** Backs `POST /api/v1/invites/resolve-code` — same flow as resolveInvite but by fallback code. */
  public async resolveInviteByCode(
    code: string,
    browserBindingHash: string,
    traceId: string,
    meta: FamilyHttpMeta,
  ): Promise<FamilyHttpSuccess<unknown>> {
    try {
      return success(await this.invites.resolveByFallbackCode(code, browserBindingHash, traceId), meta);
    } catch (error) {
      if (error instanceof InviteUnavailableError)
        throw new FamilyHttpError(404, "NOT_FOUND_OR_NOT_VISIBLE", "Invitation is unavailable.");
      throw error;
    }
  }

  public async acceptInvite(
    principal: Principal | undefined,
    attemptId: string,
    consentVersion: string,
    meta: FamilyHttpMeta,
  ): Promise<FamilyHttpSuccess<unknown>> {
    if (principal === undefined)
      throw new FamilyHttpError(401, "UNAUTHENTICATED", "Authentication is required.");
    return success(await this.invites.accept(attemptId, principal.subject, consentVersion), meta);
  }

  private async assertMember(
    principal: Principal,
    familyId: string,
    action: "family.admin" | "family.read",
  ): Promise<void> {
    const membership = await this.memberships.getMembership(familyId, principal.subject);
    const decision =
      membership === undefined
        ? authorize({ principal, action, resourceFamilyId: familyId })
        : authorize({ principal, action, resourceFamilyId: familyId, membership });
    if (!decision.allowed)
      throw decision.code === "NOT_FOUND_OR_NOT_VISIBLE"
        ? new FamilyHttpError(404, decision.code, "Family is not visible.")
        : new FamilyHttpError(403, decision.code, "The operation is forbidden.");
  }
}

function toMembershipHttpError(error: unknown): FamilyHttpError {
  if (error instanceof MembershipNotFoundError) {
    return new FamilyHttpError(404, error.code, error.message);
  }
  if (error instanceof MembershipConflictError) {
    return new FamilyHttpError(409, error.code, error.message);
  }
  if (error instanceof MembershipValidationError) {
    return new FamilyHttpError(422, error.code, error.message);
  }
  if (error instanceof FamilyHttpError) return error;
  return new FamilyHttpError(500, "INTERNAL_ERROR", "The request could not be completed.");
}

export function toFamilyHttpError(
  error: unknown,
  meta: FamilyHttpMeta,
): { status: number; body: FamilyHttpFailure } {
  if (error instanceof FamilyHttpError) {
    return {
      status: error.status,
      body: {
        error: { code: error.code, message: error.message, retryable: error.retryable },
        meta,
      },
    };
  }
  return {
    status: 500,
    body: {
      error: {
        code: "INTERNAL_ERROR",
        message: "The request could not be completed.",
        retryable: false,
      },
      meta,
    },
  };
}

function success<T>(data: T, meta: FamilyHttpMeta): FamilyHttpSuccess<T> {
  return { data, meta };
}
