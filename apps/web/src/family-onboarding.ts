import { resolveSafeRedirect } from "./shell.js";

export type FamilyOnboardingState =
  | "NO_FAMILY"
  | "CREATING"
  | "CREATE_ERROR"
  | "PENDING_AUTHENTICATION"
  | "PENDING_REVIEW"
  | "ACCEPTING"
  | "ACCEPTED"
  | "REJECTED"
  | "SWITCHING"
  | "ACTIVE"
  | "ERROR";

export interface FamilyOnboardingModel {
  readonly state: FamilyOnboardingState;
  readonly route: string;
  readonly activeFamilyId?: string;
  readonly familyName?: string;
  readonly message: string;
}

export function startOnboarding(): FamilyOnboardingModel {
  return model("NO_FAMILY", "/onboarding", "Create a family or join with an invite.");
}

export function startFamilyCreation(input: {
  readonly displayName: string;
  readonly returnTo?: string;
}): FamilyOnboardingModel {
  if (input.displayName.trim() === "") {
    return model("CREATE_ERROR", "/onboarding", "Enter a family name.");
  }
  return {
    state: "CREATING",
    route: resolveSafeRedirect(input.returnTo, "/onboarding"),
    familyName: input.displayName.trim(),
    message: "Creating your family workspace.",
  };
}

export function completeFamilyCreation(input: {
  readonly familyId: string;
  readonly displayName: string;
}): FamilyOnboardingModel {
  return activateFamily(input.familyId, input.displayName);
}

export function beginInviteEntry(token: string | undefined): FamilyOnboardingModel {
  if (token === undefined || token.trim() === "") {
    return model("ERROR", "/join", "Invitation is unavailable.");
  }
  return model("PENDING_AUTHENTICATION", "/join", "Sign in to review this invitation.");
}

export function reviewInviteRoute(input: {
  readonly attemptId: string;
  readonly familyName: string;
}): FamilyOnboardingModel {
  if (input.attemptId.trim() === "" || input.familyName.trim() === "") {
    return model("ERROR", "/join", "Invitation is unavailable.");
  }
  return {
    state: "PENDING_REVIEW",
    route: `/join/${encodeURIComponent(input.attemptId)}/review`,
    familyName: input.familyName.trim(),
    message: "Review the invitation before accepting.",
  };
}

export function acceptInviteRoute(attemptId: string): FamilyOnboardingModel {
  if (attemptId.trim() === "") return model("ERROR", "/join", "Invitation is unavailable.");
  return {
    state: "ACCEPTING",
    route: `/join/${encodeURIComponent(attemptId)}/accept`,
    message: "Joining the family workspace.",
  };
}

export function completeInviteAcceptance(input: {
  readonly familyId: string;
  readonly familyName: string;
}): FamilyOnboardingModel {
  return activateFamily(input.familyId, input.familyName);
}

export function rejectInvite(attemptId: string): FamilyOnboardingModel {
  if (attemptId.trim() === "") return model("ERROR", "/join", "Invitation is unavailable.");
  return model("REJECTED", "/inventory", "Invitation declined.");
}

export function switchFamily(input: {
  readonly currentFamilyId?: string;
  readonly targetFamilyId: string;
}): FamilyOnboardingModel {
  if (input.targetFamilyId.trim() === "" || input.targetFamilyId === input.currentFamilyId) {
    return model("ERROR", "/family", "Choose a different family.");
  }
  return {
    state: "SWITCHING",
    route: `/families/${encodeURIComponent(input.targetFamilyId)}/welcome`,
    activeFamilyId: input.targetFamilyId,
    message: "Switching family workspace.",
  };
}

export function completeFamilySwitch(input: {
  readonly familyId: string;
  readonly familyName: string;
}): FamilyOnboardingModel {
  const active = activateFamily(input.familyId, input.familyName);
  return { ...active, state: "ACTIVE", message: `Working in ${input.familyName}.` };
}

function activateFamily(familyId: string, familyName: string): FamilyOnboardingModel {
  if (familyId.trim() === "" || familyName.trim() === "") {
    return model("ERROR", "/family", "Family workspace is unavailable.");
  }
  return {
    state: "ACCEPTED",
    route: `/families/${encodeURIComponent(familyId)}/welcome`,
    activeFamilyId: familyId,
    familyName: familyName.trim(),
    message: "Welcome to your family workspace.",
  };
}

function model(
  state: FamilyOnboardingState,
  route: string,
  message: string,
): FamilyOnboardingModel {
  return { state, route, message };
}
