import { useCallback, useEffect, useRef, useState } from "react";
import type { FamilyMember, Invite, Role } from "../types";
import { members as mockMembers } from "../mockData";
import * as api from "../api/endpoints";
import { FAMILY_ID as DEFAULT_FAMILY_ID } from "../api/config";
import { reportSyncIssue } from "../lib/syncBus";
import type { InviteRole, ManagedMembershipDto, MembershipRole } from "../api/types";

export type SetMembers = React.Dispatch<React.SetStateAction<FamilyMember[]>>;

export interface UseFamilyMembersResult {
  members: FamilyMember[];
  setMembers: SetMembers;
  isDemo: boolean;
  loading: boolean;
  /** Fire-and-forget sync of a client-created invite to the backend (no-op in demo mode). */
  syncInviteCreated: (invite: Invite) => void;
}

const API_ROLE_TO_UI: Record<MembershipRole, Role> = {
  OWNER: "OWNER",
  MANAGER: "MANAGER",
  MEMBER: "MEMBER",
  VIEWER: "VIEWER",
};

const UI_ROLE_TO_API: Record<Role, MembershipRole | "ADMIN"> = {
  OWNER: "OWNER",
  MANAGER: "MANAGER",
  MEMBER: "MEMBER",
  VIEWER: "VIEWER",
};

const INVITE_ROLE_TO_API: Record<Role, InviteRole> = {
  OWNER: "MANAGER",
  MANAGER: "MANAGER",
  MEMBER: "MEMBER",
  VIEWER: "VIEWER",
};

/**
 * Loads `GET /api/v1/families/{familyId}/members` and keeps it in sync as the UI mutates it,
 * following the same diff-based pattern as `useInventory`/`useShoppingList`.
 *
 * Important limitation: `family_memberships` rows only have `userId`/`role`/`status` — there is
 * no user-profile join anywhere in this backend, so real membership rows have no display
 * name/email/avatar. The mapper below synthesizes a label from the id (`Utente xxxxxxxx`) the
 * same way `mapStockItemDtoToUi` does for products with no catalog join. Role changes and
 * removals call the real `PATCH`/`DELETE /families/{familyId}/members/{membershipId}` endpoints.
 *
 * @param familyId See the matching parameter on `useInventory`.
 */
export function useFamilyMembers(familyId?: string | null): UseFamilyMembersResult {
  const effectiveFamilyId = familyId ?? DEFAULT_FAMILY_ID ?? null;
  const [members, setMembersState] = useState<FamilyMember[]>(mockMembers);
  const [isDemo, setIsDemo] = useState(false);
  const [loading, setLoading] = useState(true);
  const isDemoRef = useRef(isDemo);
  isDemoRef.current = isDemo;
  const familyIdRef = useRef(effectiveFamilyId);
  familyIdRef.current = effectiveFamilyId;

  useEffect(() => {
    if (!effectiveFamilyId) {
      setMembersState(mockMembers);
      setIsDemo(true);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await api.listFamilyMembers(effectiveFamilyId);
        if (cancelled) return;
        setMembersState(res.memberships.filter((m) => m.status !== "REMOVED").map(mapMembershipToUi));
        setIsDemo(false);
      } catch {
        if (cancelled) return;
        setMembersState(mockMembers);
        setIsDemo(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveFamilyId]);

  const setMembers = useCallback<SetMembers>((updater) => {
    setMembersState((prev) => {
      const next = typeof updater === "function" ? (updater as (p: FamilyMember[]) => FamilyMember[])(prev) : updater;
      if (!isDemoRef.current && familyIdRef.current) void syncMembersDiff(familyIdRef.current, prev, next);
      return next;
    });
  }, []);

  const syncInviteCreated = useCallback(
    (invite: Invite) => {
      const id = effectiveFamilyId;
      if (isDemoRef.current || !id) return;
      const expiresInSeconds = Math.max(
        60,
        Math.min(86_400, Math.round((new Date(invite.expiresAt).getTime() - Date.now()) / 1000)),
      );
      api
        .createFamilyInvite(id, { role: INVITE_ROLE_TO_API[invite.role], expiresInSeconds })
        .catch((err) => console.warn("[family] failed to sync invite creation to the backend:", err));
    },
    [effectiveFamilyId],
  );

  return { members, setMembers, isDemo, loading, syncInviteCreated };
}

async function syncMembersDiff(familyId: string, prev: FamilyMember[], next: FamilyMember[]): Promise<void> {
  const prevById = new Map(prev.map((m) => [m.id, m]));
  for (const member of next) {
    const before = prevById.get(member.id);
    if (before === undefined) continue; // creation happens via invites, not directly
    if (before.role !== member.role) {
      const role = member.role;
      await api
        .updateFamilyMembership(familyId, member.id, { role: UI_ROLE_TO_API[role], status: "ACTIVE" })
        .catch((err) =>
          reportSyncIssue({
            domain: "family",
            message: `Cambio ruolo di "${member.name}" non salvato sul server.`,
            retryable: true,
            retry: () =>
              api.updateFamilyMembership(familyId, member.id, { role: UI_ROLE_TO_API[role], status: "ACTIVE" }).then(() => undefined),
          }),
        );
    }
    if (before.status !== "REMOVED" && member.status === "REMOVED") {
      await api
        .removeFamilyMembership(familyId, member.id)
        .catch((err) =>
          reportSyncIssue({
            domain: "family",
            message: `Rimozione di "${member.name}" non salvata sul server.`,
            retryable: true,
            retry: () => api.removeFamilyMembership(familyId, member.id).then(() => undefined),
          }),
        );
    }
  }
}

function mapMembershipToUi(dto: ManagedMembershipDto): FamilyMember {
  const shortId = dto.userId.slice(0, 8);
  const name = `Utente ${shortId}`;
  return {
    id: dto.id,
    name,
    email: "",
    avatar: shortId.slice(0, 2).toUpperCase(),
    role: API_ROLE_TO_UI[dto.role] ?? "MEMBER",
    status: dto.status === "REMOVED" ? "REMOVED" : dto.status === "SUSPENDED" ? "SUSPENDED" : "ACTIVE",
    joinedAt: new Date().toISOString(),
  };
}
