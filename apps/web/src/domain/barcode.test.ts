import assert from "node:assert/strict";
import test from "node:test";
import { isValidGs1Checksum, normalizeProductBarcode } from "./barcode.js";

test("normalizes valid retail product barcodes", () => {
  assert.equal(normalizeProductBarcode("4006-3813 33931"), "4006381333931");
  assert.equal(normalizeProductBarcode(" 4006381333931 "), "4006381333931");
});

test("rejects non-retail barcode payloads", () => {
  assert.equal(normalizeProductBarcode("ABC123456"), null);
  assert.equal(normalizeProductBarcode("1234567"), null);
  assert.equal(normalizeProductBarcode("123456789012345"), null);
});

test("validates GS1 check digits", () => {
  assert.equal(isValidGs1Checksum("4006381333931"), true);
  assert.equal(isValidGs1Checksum("4006381333932"), false);
});
