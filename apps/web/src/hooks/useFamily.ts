import { useCallback } from "react";
import type { FamilyMember, Invite, Role } from "../types";
import { FAMILY_NAME, members as mockMembers } from "../mockData";
import * as api from "../api/endpoints";
import { FAMILY_ID } from "../api/config";
import type { InviteRole } from "../api/types";

export interface UseFamilyResult {
  familyName: string;
  members: FamilyMember[];
  currentUserId: string;
  isDemo: boolean;
  loading: boolean;
  /** Best-effort sync of a client-created invite to `POST /families/{id}/invites`. */
  syncInviteCreated: (invite: Invite) => void;
}

const ROLE_TO_API: Record<Role, InviteRole> = {
  OWNER: "MANAGER",
  MANAGER: "MANAGER",
  MEMBER: "MEMBER",
  VIEWER: "VIEWER",
};

/**
 * There is no "list families" or "list members" endpoint in the real backend
 * (apps/api/src/family/controller.ts only exposes createFamily/createInvite/resolveInvite/
 * acceptInvite) — so the member list always shows the bundled demo family. The one real,
 * already-wired write path this hook does use is invite creation: if `VITE_FAMILY_ID` is set,
 * `syncInviteCreated` fires `POST /api/v1/families/{familyId}/invites` in the background so a
 * locally-created invite (Famiglia.tsx) also creates a real invite server-side.
 */
export function useFamily(): UseFamilyResult {
  const syncInviteCreated = useCallback((invite: Invite) => {
    if (!FAMILY_ID) return;
    const expiresInSeconds = Math.max(
      60,
      Math.min(86_400, Math.round((new Date(invite.expiresAt).getTime() - Date.now()) / 1000)),
    );
    api
      .createFamilyInvite(FAMILY_ID, { role: ROLE_TO_API[invite.role], expiresInSeconds })
      .catch((err) => console.warn("[family] failed to sync invite creation to the backend:", err));
  }, []);

  return {
    familyName: FAMILY_NAME,
    members: mockMembers,
    currentUserId: mockMembers[0].id,
    isDemo: true,
    loading: false,
    syncInviteCreated,
  };
}
