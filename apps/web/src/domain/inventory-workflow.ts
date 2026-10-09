export type ProductInputSource = "MANUAL" | "BARCODE" | "PHOTO" | "IMPORT";
export type ProductInputState =
  | "INPUT"
  | "SUBMITTING"
  | "REVIEW"
  | "MANUAL_REQUIRED"
  | "SUCCESS"
  | "OFFLINE"
  | "CONFLICT"
  | "RETRYABLE_ERROR";

export interface ProductInputModel {
  readonly source: ProductInputSource;
  readonly state: ProductInputState;
  readonly message: string;
  readonly retryable: boolean;
}

export type ExpiryState = "UNKNOWN" | "FRESH" | "EXPIRING" | "EXPIRED";

export function beginProductInput(source: ProductInputSource): ProductInputModel {
  return {
    source,
    state: "INPUT",
    message: source === "MANUAL" ? "Enter product details." : "Add a product image or identifier.",
    retryable: false,
  };
}

export function resolveProductInput(
  model: ProductInputModel,
  result: "CANDIDATE" | "MANUAL_REQUIRED" | "SUCCESS" | "OFFLINE" | "CONFLICT" | "RETRYABLE_ERROR",
): ProductInputModel {
  const messages = {
    CANDIDATE: "Review the product before adding it.",
    MANUAL_REQUIRED: "Review and enter the product manually.",
    SUCCESS: "Product added to inventory.",
    OFFLINE: "You are offline. Retry when connected.",
    CONFLICT: "Inventory changed elsewhere. Review before retrying.",
    RETRYABLE_ERROR: "The product action can be retried.",
  } as const;
  return {
    ...model,
    state: result === "CANDIDATE" ? "REVIEW" : result,
    message: messages[result],
    retryable: result === "OFFLINE" || result === "CONFLICT" || result === "RETRYABLE_ERROR",
  };
}

export function getExpiryState(
  expiresAt: string | undefined,
  now: string,
  expiringWithinDays = 7,
): ExpiryState {
  if (expiresAt === undefined) return "UNKNOWN";
  const expiry = Date.parse(expiresAt);
  const current = Date.parse(now);
  if (!Number.isFinite(expiry) || !Number.isFinite(current) || expiringWithinDays < 0) {
    return "UNKNOWN";
  }
  const daysUntilExpiry = (expiry - current) / 86_400_000;
  if (daysUntilExpiry < 0) return "EXPIRED";
  return daysUntilExpiry <= expiringWithinDays ? "EXPIRING" : "FRESH";
}
