import assert from "node:assert/strict";
import test from "node:test";
import {
  barcodeObservationsAgree,
  chooseStableBarcodeCandidate,
  classifyFrameQuality,
  consensusRequiredFrames,
  estimateBarcodeOrientationFromMoments,
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


test("does not mistake a clean white-heavy barcode for glare", () => {
  const result = classifyFrameQuality({
    sharpness: 220,
    contrast: 45,
    motion: 0.01,
    clippedFraction: 0.58,
    meanLuma: 180,
  });

  assert.equal(result.quality, "good");
  assert.equal(result.advice, "NONE");
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
  assert.equal(consensusRequiredFrames(true, "good"), 3);
  assert.equal(consensusRequiredFrames(true, "usable"), 4);
  assert.equal(consensusRequiredFrames(false, "good"), 4);
});


test("prefers a better-supported EAN-13 over a valid UPC-A false positive", () => {
  const ean = {
    value: "8003440108888",
    validated: true,
    priority: 400,
    localizationConfidence: 0.92,
    decoderAgreement: 1,
    center: { x: 500, y: 300 },
  };
  const upc = {
    value: "043000108888",
    validated: true,
    priority: 200,
    localizationConfidence: 0.35,
    decoderAgreement: 0.5,
    center: { x: 500, y: 300 },
  };

  assert.equal(chooseStableBarcodeCandidate([upc, ean])?.value, "8003440108888");
});


test("does not rotate when the local orientation evidence is ambiguous", () => {
  const estimate = estimateBarcodeOrientationFromMoments({
    varianceX: 100,
    varianceY: 20,
    covariance: 44,
    gxEnergy: 55,
    gyEnergy: 45,
    aspectRatio: 5,
  });

  assert.ok(Math.abs(estimate.rotation) < 0.001);
  assert.ok(estimate.confidence < 0.72 || Math.abs(estimate.rotation) < 0.001);
});

test("keeps the raw angle as a recovery suggestion without applying it on the first pass", () => {
  const estimate = estimateBarcodeOrientationFromMoments({
    varianceX: 100,
    varianceY: 20,
    covariance: 44,
    gxEnergy: 90,
    gyEnergy: 10,
    aspectRatio: 7,
  });

  assert.ok(Math.abs(estimate.rotation) < 0.001);
  assert.ok(Math.abs(estimate.suggestedRotation * 180 / Math.PI) > 15);
});

test("keeps a well-supported small rotation for a real barcode", () => {
  const estimate = estimateBarcodeOrientationFromMoments({
    varianceX: 120,
    varianceY: 10,
    covariance: 24.5,
    gxEnergy: 92,
    gyEnergy: 8,
    aspectRatio: 7,
  });

  assert.ok(Math.abs(estimate.rotation * 180 / Math.PI - (-12)) < 1.5 || Math.abs(estimate.rotation * 180 / Math.PI - 12) < 1.5);
  assert.ok(estimate.confidence >= 0.72);
});

test("rejects an implausibly large correction even when the edge cloud is strong", () => {
  const estimate = estimateBarcodeOrientationFromMoments({
    varianceX: 120,
    varianceY: 10,
    covariance: 85,
    gxEnergy: 92,
    gyEnergy: 8,
    aspectRatio: 7,
  });

  assert.ok(Math.abs(estimate.rotation) < 0.001);
});
