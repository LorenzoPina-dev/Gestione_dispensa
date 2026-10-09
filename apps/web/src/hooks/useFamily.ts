import { useCallback, useEffect, useState } from "react";
import type { FamilyMember, Invite, Role } from "../types";
import * as api from "../api/endpoints";
import { FAMILY_ID as DEFAULT_FAMILY_ID } from "../api/config";
import type { InviteRole, ManagedMembershipDto, MembershipRole } from "../api/types";
export type SetMembers = React.Dispatch<React.SetStateAction<FamilyMember[]>>;
export interface UseFamilyMembersResult { members: FamilyMember[]; setMembers: SetMembers; isDemo: boolean; loading: boolean; syncInviteCreated: (invite: Invite) => Promise<Invite>; familyName: string; }
const API_ROLE_TO_UI: Record<MembershipRole, Role> = { OWNER: "OWNER", MANAGER: "MANAGER", MEMBER: "MEMBER", VIEWER: "VIEWER" };
const INVITE_ROLE_TO_API: Record<Role, InviteRole> = { OWNER: "MANAGER", MANAGER: "MANAGER", MEMBER: "MEMBER", VIEWER: "VIEWER" };
export function useFamilyMembers(familyId?: string | null, initialMembers?: FamilyMember[], initialFamilyName?: string): UseFamilyMembersResult {
  const effectiveFamilyId = familyId ?? DEFAULT_FAMILY_ID ?? null;
  const [members, setMembersState] = useState<FamilyMember[]>([]);
  const [isDemo, setIsDemo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [familyName, setFamilyName] = useState("Famiglia");
  useEffect(() => {
    if (initialMembers !== undefined) { setMembersState(initialMembers); if (initialFamilyName) setFamilyName(initialFamilyName); setIsDemo(false); setLoading(false); return; }
    if (!effectiveFamilyId) { setMembersState([]); setIsDemo(false); setLoading(false); return; }
    let cancelled = false; setLoading(true);
    (async () => { try { const families = await api.listFamilies(); const current = families.families.find((f) => f.familyId === effectiveFamilyId); if (current) setFamilyName(current.displayName ?? current.name); const res = await api.listFamilyMembers(effectiveFamilyId); if (cancelled) return; setMembersState(res.memberships.filter((m) => m.status !== "REMOVED").map(mapMembershipToUi)); setIsDemo(false); } catch { if (cancelled) return; setMembersState([]); setIsDemo(false); } finally { if (!cancelled) setLoading(false); } })();
    return () => { cancelled = true; };
  }, [effectiveFamilyId, initialMembers, initialFamilyName]);
  const setMembers = useCallback<SetMembers>((updater) => setMembersState((prev) => typeof updater === "function" ? (updater as (p: FamilyMember[]) => FamilyMember[])(prev) : updater), []);
  const syncInviteCreated = useCallback(async (invite: Invite): Promise<Invite> => {
    if (!effectiveFamilyId) return invite;
    const expiresInSeconds = Math.max(3600, Math.min(172800, Math.round((new Date(invite.expiresAt).getTime() - Date.now()) / 1000)));
    const created = await api.createFamilyInvite(effectiveFamilyId, { role: INVITE_ROLE_TO_API[invite.role], expiresInSeconds });
    return { inviteId: created.inviteId, role: created.role, status: created.status === "pending" ? "CREATED" : created.status, expiresAt: created.expiresAt, fallbackCode: created.fallbackCode ?? "", createdAt: new Date().toISOString(), ...(created.qrPayload ? { qrPayload: created.qrPayload } : {}) };
  }, [effectiveFamilyId]);
  return { members, setMembers, isDemo, loading, syncInviteCreated, familyName };
}
function mapMembershipToUi(dto: ManagedMembershipDto): FamilyMember {
  const shortId = dto.userId.slice(0, 8); const name = dto.name || `Utente ${shortId}`;
  return { id: dto.id, name, email: dto.email || "", avatar: dto.avatar || shortId.slice(0, 2).toUpperCase(), role: API_ROLE_TO_UI[dto.role] ?? "MEMBER", status: dto.status === "REMOVED" ? "REMOVED" : dto.status === "SUSPENDED" ? "SUSPENDED" : "ACTIVE", version: dto.version, joinedAt: dto.joinedAt || new Date().toISOString() };
}
