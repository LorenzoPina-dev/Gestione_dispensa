import { resolveSafeRedirect } from "./shell.js";

export type FamilyJourneyState =
  | "NO_FAMILY"
  | "CREATING"
  | "ACTIVE"
  | "PENDING_AUTHENTICATION"
  | "PENDING_REVIEW"
  | "ACCEPTED"
  | "REJECTED"
  | "EXPIRED"
  | "UNAVAILABLE";

export interface FamilyJourneyModel {
  readonly state: FamilyJourneyState;
  readonly returnTo: string;
  readonly familyName?: string;
  readonly proposedRole?: "MANAGER" | "MEMBER" | "VIEWER";
  readonly expiresAt?: string;
  readonly message: string;
}

export function resolveJoinEntry(queryValue: string | undefined): FamilyJourneyModel {
  if (queryValue === undefined || queryValue.trim() === "") {
    return model("UNAVAILABLE", "Invitation is unavailable.");
  }
  return model("PENDING_AUTHENTICATION", "Sign in to review this invitation.");
}

export function reviewInvite(input: {
  readonly familyName: string;
  readonly proposedRole: "MANAGER" | "MEMBER" | "VIEWER";
  readonly expiresAt: string;
  readonly returnTo?: string;
}): FamilyJourneyModel {
  return {
    state: "PENDING_REVIEW",
    returnTo: resolveSafeRedirect(input.returnTo, "/join/review"),
    familyName: input.familyName,
    proposedRole: input.proposedRole,
    expiresAt: input.expiresAt,
    message: "Review the invitation before accepting.",
  };
}

export function acceptInvite(familyId: string): FamilyJourneyModel {
  if (familyId.trim() === "") return model("UNAVAILABLE", "Invitation is unavailable.");
  return {
    state: "ACCEPTED",
    returnTo: `/families/${encodeURIComponent(familyId)}/welcome`,
    message: "Welcome to your family workspace.",
  };
}

function model(state: FamilyJourneyState, message: string): FamilyJourneyModel {
  return { state, returnTo: "/inventory", message };
}
