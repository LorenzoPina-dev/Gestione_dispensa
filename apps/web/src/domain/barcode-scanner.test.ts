import assert from "node:assert/strict";
import test from "node:test";
import {
  barcodeObservationsAgree,
  classifyFrameQuality,
  consensusRequiredFrames,
} from "./barcode-scanner.js";

test("classifies a sharp stable barcode frame as good", () => {
  const result = classifyFrameQuality({
    sharpness: 220,
    contrast: 40,
    motion: 0.01,
    clippedFraction: 0.04,
    meanLuma: 125,
  });

  assert.equal(result.quality, "good");
  assert.equal(result.advice, "NONE");
  assert.ok(result.score > 0.68);
});

test("detects motion as the primary guidance signal", () => {
  const result = classifyFrameQuality({
    sharpness: 220,
    contrast: 40,
    motion: 0.21,
    clippedFraction: 0.03,
    meanLuma: 125,
  });

  assert.equal(result.advice, "STEADY");
});

test("requires focus guidance for a soft frame", () => {
  const result = classifyFrameQuality({
    sharpness: 25,
    contrast: 15,
    motion: 0.01,
    clippedFraction: 0.03,
    meanLuma: 120,
  });

  assert.equal(result.quality, "poor");
  assert.equal(result.advice, "FOCUS");
});

test("requires spatial agreement for repeated detections", () => {
  const a = { value: "4006381333931", center: { x: 500, y: 300 }, bounds: { x: 400, y: 280, width: 200, height: 50 } };
  const b = { value: "4006381333931", center: { x: 510, y: 305 }, bounds: { x: 410, y: 285, width: 195, height: 48 } };
  const c = { value: "4006381333931", center: { x: 800, y: 600 }, bounds: { x: 700, y: 570, width: 80, height: 20 } };

  assert.equal(barcodeObservationsAgree(a, b, 1000, 600), true);
  assert.equal(barcodeObservationsAgree(a, c, 1000, 600), false);
});

test("uses stricter consensus for uncertain detections", () => {
  assert.equal(consensusRequiredFrames(true, "good"), 2);
  assert.equal(consensusRequiredFrames(true, "usable"), 3);
  assert.equal(consensusRequiredFrames(false, "good"), 3);
});
