export const OCR_JOB_TYPES = ["receipt", "pantry_image"] as const;
export const OCR_JOB_STATUSES = ["queued","processing","completed","needs_review","failed","cancelled"] as const;
export function isJobType(value: unknown): value is typeof OCR_JOB_TYPES[number] { return typeof value === "string" && OCR_JOB_TYPES.includes(value as any); }
export function isJobStatus(value: unknown): value is typeof OCR_JOB_STATUSES[number] { return typeof value === "string" && OCR_JOB_STATUSES.includes(value as any); }
export function isConfidence(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1; }
export function isPositiveNumber(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value > 0; }
