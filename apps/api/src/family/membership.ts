import type { MembershipRole, MembershipStatus } from "../identity/authorization.js";

export type AssignableMembershipRole = Exclude<MembershipRole, "OWNER">;

export interface ManagedMembership {
  id: string;
  familyId: string;
  userId: string;
  role: MembershipRole;
  status: MembershipStatus;
  version: number;
}

export interface MembershipRepository {
  getById(familyId: string, membershipId: string): Promise<ManagedMembership | undefined>;
  listByFamily(familyId: string): Promise<readonly ManagedMembership[]>;
  countActiveOwners(familyId: string): Promise<number>;
  updateAtomic(input: {
    familyId: string;
    membershipId: string;
    role: MembershipRole;
    status: Extract<MembershipStatus, "ACTIVE" | "SUSPENDED">;
  }): Promise<ManagedMembership>;
  removeAtomic(input: { familyId: string; membershipId: string; removedAt: Date }): Promise<void>;
}

export class MembershipValidationError extends Error {
  public readonly code = "VALIDATION_ERROR";

  public constructor(message: string) {
    super(message);
    this.name = "MembershipValidationError";
  }
}

export class MembershipConflictError extends Error {
  public readonly code = "MEMBERSHIP_CONFLICT";

  public constructor(message: string) {
    super(message);
    this.name = "MembershipConflictError";
  }
}

export class MembershipNotFoundError extends Error {
  public readonly code = "NOT_FOUND_OR_NOT_VISIBLE";

  public constructor() {
    super("Membership is not visible.");
    this.name = "MembershipNotFoundError";
  }
}

const ASSIGNABLE_ROLES = new Set<AssignableMembershipRole>(["MANAGER", "MEMBER", "VIEWER"]);

export function mapContractRole(role: string): AssignableMembershipRole {
  if (role === "ADMIN" || role === "MANAGER") return "MANAGER";
  if (role === "MEMBER" || role === "VIEWER") return role;
  throw new MembershipValidationError("role is invalid");
}

export class MembershipService {
  private readonly repository: MembershipRepository;
  private readonly activeFamilyByUser = new Map<string, string>();

  public constructor(repository: MembershipRepository) {
    this.repository = repository;
  }

  public async listMembers(familyId: string): Promise<readonly ManagedMembership[]> {
    return (await this.repository.listByFamily(familyId)).filter(
      (membership) => membership.status !== "REMOVED",
    );
  }

  public async updateMembership(input: {
    familyId: string;
    membershipId: string;
    role: string;
    status: string;
  }): Promise<ManagedMembership> {
    const role = mapContractRole(input.role);
    if (input.status !== "ACTIVE" && input.status !== "SUSPENDED") {
      throw new MembershipValidationError("status is invalid");
    }
    const current = await this.requireMembership(input.familyId, input.membershipId);
    if (current.role === "OWNER") {
      throw new MembershipConflictError("The owner membership cannot be changed this way.");
    }
    return this.repository.updateAtomic({
      familyId: input.familyId,
      membershipId: input.membershipId,
      role,
      status: input.status,
    });
  }

  public async removeMembership(input: {
    familyId: string;
    membershipId: string;
    removedAt: Date;
  }): Promise<ManagedMembership> {
    const current = await this.requireMembership(input.familyId, input.membershipId);
    if (current.role === "OWNER" && (await this.repository.countActiveOwners(input.familyId)) <= 1) {
      throw new MembershipConflictError("The last owner cannot be removed.");
    }
    await this.repository.removeAtomic({
      familyId: input.familyId,
      membershipId: input.membershipId,
      removedAt: input.removedAt,
    });
    return { ...current, status: "REMOVED" };
  }

  public activateFamily(userId: string, familyId: string): { familyId: string } {
    this.activeFamilyByUser.set(userId, familyId);
    return { familyId };
  }

  public activeFamily(userId: string): string | undefined {
    return this.activeFamilyByUser.get(userId);
  }

  private async requireMembership(
    familyId: string,
    membershipId: string,
  ): Promise<ManagedMembership> {
    const membership = await this.repository.getById(familyId, membershipId);
    if (membership === undefined || membership.status === "REMOVED") {
      throw new MembershipNotFoundError();
    }
    return membership;
  }
}
