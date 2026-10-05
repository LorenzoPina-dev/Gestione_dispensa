/**
 * Product barcode domain rules.
 *
 * Open Food Facts product lookup is keyed by retail identifiers, so the web
 * scanner accepts only numeric GTIN/EAN/UPC lengths. Image decoders may support
 * additional symbologies, but those are not valid inputs to this product flow.
 */

const PRODUCT_BARCODE_PATTERN = /^(?:\d{8}|\d{12}|\d{13}|\d{14})$/;

export function normalizeProductBarcode(value: string): string | null {
  const normalized = value.trim().replace(/[\s-]+/g, "");
  return PRODUCT_BARCODE_PATTERN.test(normalized) ? normalized : null;
}

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
