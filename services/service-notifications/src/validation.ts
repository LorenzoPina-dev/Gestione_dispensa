export const NOTIFICATION_CHANNELS = ["inApp", "email", "push"] as const;
export function isBoolean(value: unknown): value is boolean { return typeof value === "boolean"; }
export function isNotificationFamilyContext(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
export function validIdempotencyKey(value: unknown): value is string { return typeof value === "string" && value.trim().length >= 8; }
