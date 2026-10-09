export const STORAGE_VALUES = ["PANTRY","FRIDGE","FREEZER","CELLAR","OTHER"] as const;
export const PREDICTION_STATUSES = ["queued","completed","applied","superseded","failed"] as const;
export function isStorage(value: unknown): value is typeof STORAGE_VALUES[number] { return typeof value === "string" && STORAGE_VALUES.includes(value as any); }
export function isBoolean(value: unknown): value is boolean { return typeof value === "boolean"; }
export function isConfidence(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1; }
export function isPredictionStatus(value: unknown): value is typeof PREDICTION_STATUSES[number] { return typeof value === "string" && PREDICTION_STATUSES.includes(value as any); }
