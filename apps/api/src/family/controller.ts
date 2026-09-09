import { authorize, type MembershipContext } from "../identity/authorization.js";
import type { Principal } from "../identity/oidc.js";
import { FamilyService, type CreateFamilyCommand } from "./service.js";
import { InviteService, InviteUnavailableError, type InviteRole } from "./invites.js";

export interface FamilyMembershipReader {
  getMembership(familyId: string, userId: string): Promise<MembershipContext | undefined>;
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

  public constructor(
    families: FamilyService,
    invites: InviteService,
    memberships: FamilyMembershipReader,
  ) {
    this.families = families;
    this.invites = invites;
    this.memberships = memberships;
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

  public async createInvite(
    principal: Principal | undefined,
    familyId: string,
    input: { role: InviteRole; expiresInSeconds: number },
    meta: FamilyHttpMeta,
  ): Promise<FamilyHttpSuccess<unknown>> {
    if (principal === undefined)
      throw new FamilyHttpError(401, "UNAUTHENTICATED", "Authentication is required.");
    const membership = await this.memberships.getMembership(familyId, principal.subject);
    const decision =
      membership === undefined
        ? authorize({ principal, action: "family.admin", resourceFamilyId: familyId })
        : authorize({ principal, action: "family.admin", resourceFamilyId: familyId, membership });
    if (!decision.allowed)
      throw decision.code === "NOT_FOUND_OR_NOT_VISIBLE"
        ? new FamilyHttpError(404, decision.code, "Family is not visible.")
        : new FamilyHttpError(403, decision.code, "The operation is forbidden.");
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
