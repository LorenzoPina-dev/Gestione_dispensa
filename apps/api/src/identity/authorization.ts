import type { Principal } from "./oidc.js";

export type AuthorizationAction =
  | "family.read"
  | "family.write"
  | "family.admin"
  | "inventory.read"
  | "inventory.write"
  | "shopping.read"
  | "shopping.write"
  | "owner"
  | "operator";

export type MembershipRole = "OWNER" | "MANAGER" | "MEMBER" | "VIEWER";
export type MembershipStatus = "ACTIVE" | "SUSPENDED" | "REMOVED" | "PENDING";

export interface MembershipContext {
  familyId: string;
  userId: string;
  role: MembershipRole | "CREATOR" | "ADMIN";
  status: MembershipStatus;
}

export interface AuthorizationRequest {
  principal: Principal | undefined;
  action: AuthorizationAction;
  resourceFamilyId?: string;
  resourceOwnerId?: string;
  membership?: MembershipContext;
}

export interface AuthorizationDecision {
  allowed: boolean;
  code: "ALLOW" | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND_OR_NOT_VISIBLE";
  policyVersion: string;
}

const POLICY_VERSION = "family-rbac-v1";

export function authorize(request: AuthorizationRequest): AuthorizationDecision {
  if (request.principal === undefined) {
    return deny("UNAUTHENTICATED");
  }

  if (request.action === "operator") {
    return request.principal.scopes.includes("operator") ||
      request.principal.roles.includes("PLATFORM_OPERATOR")
      ? allow()
      : deny("FORBIDDEN");
  }

  if (request.action === "owner") {
    return request.resourceOwnerId === request.principal.subject ? allow() : deny("FORBIDDEN");
  }

  if (request.membership === undefined || request.membership.status !== "ACTIVE") {
    return deny("NOT_FOUND_OR_NOT_VISIBLE");
  }

  if (
    request.resourceFamilyId !== undefined &&
    request.resourceFamilyId !== request.membership.familyId
  ) {
    return deny("NOT_FOUND_OR_NOT_VISIBLE");
  }
  if (request.membership.userId !== request.principal.subject) {
    return deny("FORBIDDEN");
  }

  const role = normalizeRole(request.membership.role);
  return roleAllows(role, request.action) ? allow() : deny("FORBIDDEN");
}

function normalizeRole(role: MembershipContext["role"]): MembershipRole {
  if (role === "CREATOR") {
    return "OWNER";
  }
  if (role === "ADMIN") {
    return "MANAGER";
  }
  return role;
}

function roleAllows(role: MembershipRole, action: AuthorizationAction): boolean {
  if (action === "family.read" || action === "inventory.read" || action === "shopping.read") {
    return true;
  }
  if (action === "family.admin") {
    return role === "OWNER" || role === "MANAGER";
  }
  if (action === "family.write" || action === "inventory.write" || action === "shopping.write") {
    return role === "OWNER" || role === "MANAGER" || role === "MEMBER";
  }
  return false;
}

function allow(): AuthorizationDecision {
  return { allowed: true, code: "ALLOW", policyVersion: POLICY_VERSION };
}

function deny(code: Exclude<AuthorizationDecision["code"], "ALLOW">): AuthorizationDecision {
  return { allowed: false, code, policyVersion: POLICY_VERSION };
}
