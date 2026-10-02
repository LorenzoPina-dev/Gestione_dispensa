export type FamilyRole = "owner" | "admin" | "member";
export type InviteRole = "admin" | "member" | "viewer";

export function normalizeFamilyName(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function canWrite(role: string | null): boolean {
  return role === "owner" || role === "admin";
}

export function isMembershipRole(value: unknown): value is Exclude<FamilyRole, "owner"> | "viewer" {
  return value === "admin" || value === "member" || value === "viewer";
}

export function isInviteRole(value: unknown): value is InviteRole {
  return value === "admin" || value === "member" || value === "viewer";
}

export function isValidInviteExpiry(value: unknown): boolean {
  return Number.isInteger(value) && Number(value) >= 3600 && Number(value) <= 604800;
}

export function isValidEmail(value: unknown): boolean {
  return value === null || (typeof value === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value));
}

export function isValidBrowserBindingHash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{16,128}$/i.test(value);
}

export function normalizeInviteCode(value: unknown): string {
  return typeof value === "string" ? value.replace(/[^0-9]/g, "") : "";
}

export function isValidInviteCode(value: unknown): boolean {
  return /^\d{6}$/.test(normalizeInviteCode(value));
}

export function isValidVersion(value: unknown): boolean {
  return /^\d+$/.test(String(value ?? "")) && Number(value) >= 1;
}
