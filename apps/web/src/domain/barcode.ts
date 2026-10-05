/**
 * Product barcode domain rules.
 *
 * The camera pipeline can see several valid-looking numeric strings at once.
 * A GS1 check digit is necessary but NOT sufficient to identify the intended
 * product: two unrelated candidates can both have a valid check digit.
 * Therefore the scanner also exposes a symbology/length preference used by the
 * temporal consensus layer.
 */

const PRODUCT_BARCODE_PATTERN = /^(?:\\d{8}|\\d{12}|\\d{13}|\\d{14})$/;

export type ProductBarcodeKind = "EAN_8" | "UPC_A" | "EAN_13" | "GTIN_14";

export function normalizeProductBarcode(value: string): string | null {
  const normalized = value.trim().replace(/[\\s-]+/g, "");
  return PRODUCT_BARCODE_PATTERN.test(normalized) ? normalized : null;
}

export function productBarcodeKind(value: string): ProductBarcodeKind | null {
  switch (value.length) {
    case 8: return "EAN_8";
    case 12: return "UPC_A";
    case 13: return "EAN_13";
    case 14: return "GTIN_14";
    default: return null;
  }
}

/** EAN/UPC/GTIN modulo-10 check digit. */
export function isValidGs1Checksum(value: string): boolean {
  if (!PRODUCT_BARCODE_PATTERN.test(value)) return false;

  let sum = 0;
  let weight = 3;
  for (let i = value.length - 2; i >= 0; i--) {
    sum += Number(value[i]) * weight;
    weight = weight === 3 ? 1 : 3;
  }

  const expected = (10 - (sum % 10)) % 10;
  return expected === Number(value[value.length - 1]);
}

/**
 * Rank candidates without ever accepting a weaker candidate merely because it
 * appeared first. EAN-13 is preferred for the Italian retail flow, then GTIN-14,
 * UPC-A and EAN-8. Checksum-validity remains a hard prerequisite for product lookup.
 */
export function productBarcodePriority(value: string): number {
  switch (productBarcodeKind(value)) {
    case "EAN_13": return 400;
    case "GTIN_14": return 300;
    case "UPC_A": return 200;
    case "EAN_8": return 100;
    default: return 0;
  }
}

/** A numeric candidate is safe for lookup only after checksum validation. */
export function isTrustedProductBarcode(value: string): boolean {
  return normalizeProductBarcode(value) !== null && isValidGs1Checksum(value);
}
