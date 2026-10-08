import type { SafetyProfile } from "./safety-engine.js";

export interface FamilySafetyProfile extends SafetyProfile {
  memberCount: number;
  complete: boolean;
  missingPreferenceUserIds: string[];
}

export function aggregateFamilySafetyProfiles(
  memberUserIds: readonly string[],
  profiles: ReadonlyArray<{
    userId:string;
    exists:boolean;
    allergenTags:string[];
    dietaryRestrictions:string[];
    tracePolicy:"WARN"|"EXCLUDE";
    uncertaintyPolicy:"WARN"|"EXCLUDE";
  }>,
): FamilySafetyProfile {
  const uniqueMembers=[...new Set(memberUserIds)];
  const byUser=new Map(profiles.map(profile=>[profile.userId,profile]));
  const allergenTags=[...new Set(profiles.flatMap(profile=>profile.allergenTags))];
  const dietaryRestrictions=[...new Set(profiles.flatMap(profile=>profile.dietaryRestrictions))];
  const tracePolicy=profiles.some(profile=>profile.tracePolicy==="EXCLUDE")?"EXCLUDE":"WARN";
  const uncertaintyPolicy=profiles.some(profile=>profile.uncertaintyPolicy==="EXCLUDE")?"EXCLUDE":"WARN";
  const missingPreferenceUserIds=uniqueMembers.filter(userId=>!byUser.has(userId)||!byUser.get(userId)!.exists);
  return {
    allergenTags,
    dietaryRestrictions,
    tracePolicy,
    uncertaintyPolicy,
    memberCount:uniqueMembers.length,
    complete:missingPreferenceUserIds.length===0 && profiles.length===uniqueMembers.length,
    missingPreferenceUserIds,
  };
}
