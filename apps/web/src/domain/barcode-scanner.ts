/**
 * Pure scanner policies shared by the live camera pipeline.
 *
 * These functions deliberately do not touch browser APIs so they can be unit tested
 * with deterministic synthetic measurements.
 */

export type FrameQuality = "poor" | "usable" | "good";

export type FrameQualityInput = {
  sharpness: number;
  contrast: number;
  motion: number;
  clippedFraction: number;
  meanLuma: number;
};

export type FrameQualityResult = FrameQualityInput & {
  quality: FrameQuality;
  score: number;
  advice: "STEADY" | "FOCUS" | "LIGHT" | "GLARE" | "MOVE_CLOSER" | "NONE";
};

export type BarcodeBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BarcodeObservation = {
  value: string;
  center?: { x: number; y: number };
  bounds?: BarcodeBounds;
};

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function rangeScore(value: number, start: number, end: number): number {
  if (value <= start) return 0;
  if (value >= end) return 1;
  return (value - start) / (end - start);
}

function inverseScore(value: number, goodAtOrBelow: number, zeroAtOrAbove: number): number {
  if (value <= goodAtOrBelow) return 1;
  if (value >= zeroAtOrAbove) return 0;
  return 1 - (value - goodAtOrBelow) / (zeroAtOrAbove - goodAtOrBelow);
}

function sharpnessScore(value: number): number {
  // Log compression keeps high-resolution cameras from dominating the score while
  // preserving the important low-sharpness separation.
  const low = Math.log1p(35);
  const high = Math.log1p(500);
  return clamp01((Math.log1p(Math.max(0, value)) - low) / (high - low));
}

export function classifyFrameQuality(input: FrameQualityInput): FrameQualityResult {
  const sharpness = Math.max(0, input.sharpness);
  const contrast = Math.max(0, input.contrast);
  const motion = Math.max(0, input.motion);
  const clippedFraction = clamp01(input.clippedFraction);
  const meanLuma = Math.max(0, Math.min(255, input.meanLuma));

  const score =
    sharpnessScore(sharpness) * 0.38 +
    rangeScore(contrast, 8, 45) * 0.22 +
    inverseScore(motion, 0.03, 0.22) * 0.18 +
    inverseScore(clippedFraction, 0.04, 0.82) * 0.12 +
    (1 - Math.min(1, Math.abs(meanLuma - 135) / 135)) * 0.1;

  let quality: FrameQuality = "usable";
  if (
    score < 0.42 ||
    sharpness < 35 ||
    contrast < 8 ||
    motion > 0.28 ||
    clippedFraction > 0.82
  ) {
    quality = "poor";
  } else if (
    score >= 0.68 &&
    sharpness >= 110 &&
    contrast >= 22 &&
    motion <= 0.1 &&
    clippedFraction <= 0.62
  ) {
    quality = "good";
  }

  let advice: FrameQualityResult["advice"] = "NONE";
  if (motion > 0.16) advice = "STEADY";
  else if (sharpness < 55) advice = "FOCUS";
  else if (clippedFraction > 0.68) advice = "GLARE";
  else if (meanLuma < 45) advice = "LIGHT";

  return {
    sharpness,
    contrast,
    motion,
    clippedFraction,
    meanLuma,
    quality,
    score,
    advice,
  };
}

function normalizedDistance(a: number, b: number, extent: number): number {
  return Math.abs(a - b) / Math.max(1, extent);
}

/**
 * Two detections are considered the same physical barcode only when the decoded value
 * AND the observed position roughly agree. This prevents a transient false positive
 * from being promoted merely because the decoder repeats the same digits.
 */
export function barcodeObservationsAgree(
  a: BarcodeObservation,
  b: BarcodeObservation,
  frameWidth: number,
  frameHeight: number,
): boolean {
  if (a.value !== b.value) return false;

  if (a.center && b.center) {
    const distance = Math.hypot(
      normalizedDistance(a.center.x, b.center.x, frameWidth),
      normalizedDistance(a.center.y, b.center.y, frameHeight),
    );
    if (distance > 0.13) return false;
  }

  if (a.bounds && b.bounds) {
    const aArea = Math.max(1, a.bounds.width * a.bounds.height);
    const bArea = Math.max(1, b.bounds.width * b.bounds.height);
    const areaRatio = Math.min(aArea, bArea) / Math.max(aArea, bArea);
    if (areaRatio < 0.3) return false;
  }

  return true;
}

export type BarcodeConsensusCandidate = BarcodeObservation & {
  validated: boolean;
  priority: number;
  format?: string;
};

/**
 * Require repeated agreement for difficult frames. A checksum-valid EAN/UPC still
 * needs temporal confirmation because a decoder can consistently hallucinate a
 * different valid GTIN from a dense 1D pattern.
 */
export function consensusRequiredFrames(
  validated: boolean,
  quality: FrameQuality,
): number {
  if (!validated) return 4;
  return quality === "good" ? 3 : 4;
}

export function chooseStableBarcodeCandidate(
  candidates: readonly BarcodeConsensusCandidate[],
): BarcodeConsensusCandidate | null {
  if (candidates.length === 0) return null;

  const grouped = new Map<string, { candidate: BarcodeConsensusCandidate; count: number; priority: number }>();
  for (const candidate of candidates) {
    const current = grouped.get(candidate.value);
    if (!current) {
      grouped.set(candidate.value, { candidate, count: 1, priority: candidate.priority });
      continue;
    }
    current.count += 1;
    current.priority = Math.max(current.priority, candidate.priority);
    if (candidate.validated && !current.candidate.validated) current.candidate = candidate;
  }

  return [...grouped.values()]
    .sort((a, b) =>
      Number(b.candidate.validated) - Number(a.candidate.validated) ||
      b.count - a.count ||
      b.priority - a.priority,
    )[0]?.candidate ?? null;
}
