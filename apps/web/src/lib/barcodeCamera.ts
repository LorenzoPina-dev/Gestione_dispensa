/**
 * Camera control for the barcode scanner.
 *
 * The browser is only a transport layer: actual camera capabilities are
 * device-dependent. We therefore request a high-quality profile first, then
 * inspect and tune the live MediaStreamTrack.
 */

export interface CameraDiagnostics {
  width: number;
  height: number;
  frameRate: number | null;
  aspectRatio: number | null;
  facingMode: string | null;
  deviceId: string | null;
  focusMode: string | null;
  continuousFocus: boolean;
  zoom: number | null;
  zoomSupported: boolean;
  torchSupported: boolean;
  torchEnabled: boolean;
}

type CapabilityBag = Record<string, unknown>;

type PointOfInterest = { x: number; y: number };

const TARGET_WIDTH = 2560;
const TARGET_HEIGHT = 1440;
const MIN_WIDTH = 1280;
const MIN_HEIGHT = 720;
const TARGET_FPS = 30;
const AUTO_ZOOM = 1.25;

const HIGH_QUALITY_VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  facingMode: { ideal: "environment" },
  width: { ideal: TARGET_WIDTH, min: MIN_WIDTH },
  height: { ideal: TARGET_HEIGHT, min: MIN_HEIGHT },
  frameRate: { ideal: TARGET_FPS, max: TARGET_FPS },
  aspectRatio: { ideal: 16 / 9 },
};

export function getBarcodeCameraConstraints(): MediaStreamConstraints {
  return {
    audio: false,
    video: HIGH_QUALITY_VIDEO_CONSTRAINTS,
  };
}

function asCapabilityBag(value: unknown): CapabilityBag {
  return value && typeof value === "object" ? (value as CapabilityBag) : {};
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function numericRange(
  value: unknown,
): { min: number; max: number; step: number } | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { min?: unknown; max?: unknown; step?: unknown };
  if (typeof candidate.min !== "number" || typeof candidate.max !== "number") return null;
  const step = typeof candidate.step === "number" && candidate.step > 0 ? candidate.step : 0.1;
  return { min: candidate.min, max: candidate.max, step };
}

function clampToStep(value: number, range: { min: number; max: number; step: number }): number {
  const clamped = Math.min(range.max, Math.max(range.min, value));
  const offset = Math.round((clamped - range.min) / range.step) * range.step;
  return Number(Math.min(range.max, Math.max(range.min, range.min + offset)).toFixed(3));
}

function setContentHint(track: MediaStreamTrack): void {
  try {
    const candidate = track as MediaStreamTrack & { contentHint?: string };
    if ("contentHint" in candidate) candidate.contentHint = "detail";
  } catch {
    // Optional optimization only.
  }
}

async function applyPatchSafely(
  track: MediaStreamTrack,
  patches: Record<string, unknown>[],
): Promise<void> {
  if (patches.length === 0) return;

  const base = track.getConstraints();
  const { advanced: _ignored, ...baseWithoutAdvanced } = base;
  const applied: Record<string, unknown>[] = [];

  for (const patch of patches) {
    try {
      await track.applyConstraints({
        ...baseWithoutAdvanced,
        advanced: [...applied, patch] as MediaTrackConstraintSet[],
      });
      applied.push(patch);
    } catch {
      // Some browsers expose a capability but reject the exact constraint.
      // Keep the rest of the camera profile rather than failing the camera.
    }
  }
}

export async function configureBarcodeCamera(
  track: MediaStreamTrack,
): Promise<CameraDiagnostics> {
  setContentHint(track);

  let capabilities: CapabilityBag = {};
  try {
    capabilities = asCapabilityBag(track.getCapabilities());
  } catch {
    capabilities = {};
  }

  const supported = navigator.mediaDevices.getSupportedConstraints?.() ?? {};
  const patches: Record<string, unknown>[] = [];

  if (
    supported.focusMode &&
    stringList(capabilities.focusMode).includes("continuous")
  ) {
    patches.push({
      focusMode: "continuous",
      ...(supported.pointsOfInterest
        ? { pointsOfInterest: [{ x: 0.5, y: 0.5 } as PointOfInterest] }
        : {}),
    });
  }

  if (
    supported.resizeMode &&
    stringList(capabilities.resizeMode).includes("none")
  ) {
    patches.push({ resizeMode: "none" });
  }

  const zoomRange = numericRange(capabilities.zoom);
  const settings = track.getSettings();
  const currentZoom =
    typeof settings.zoom === "number" ? settings.zoom : zoomRange?.min ?? null;

  if (zoomRange && supported.zoom !== false) {
    const targetZoom = clampToStep(
      Math.max(currentZoom ?? zoomRange.min, AUTO_ZOOM),
      zoomRange,
    );
    if (targetZoom > zoomRange.min) patches.push({ zoom: targetZoom });
  }

  await applyPatchSafely(track, patches);
  return readCameraDiagnostics(track);
}

export function readCameraDiagnostics(track: MediaStreamTrack): CameraDiagnostics {
  const settings = track.getSettings();
  let capabilities: CapabilityBag = {};
  try {
    capabilities = asCapabilityBag(track.getCapabilities());
  } catch {
    capabilities = {};
  }

  const zoomRange = numericRange(capabilities.zoom);
  const focusModes = stringList(capabilities.focusMode);

  return {
    width: settings.width ?? 0,
    height: settings.height ?? 0,
    frameRate: settings.frameRate ?? null,
    aspectRatio: settings.aspectRatio ?? null,
    facingMode: settings.facingMode ?? null,
    deviceId: settings.deviceId ?? null,
    focusMode: typeof settings.focusMode === "string" ? settings.focusMode : null,
    continuousFocus: focusModes.includes("continuous") || settings.focusMode === "continuous",
    zoom: typeof settings.zoom === "number" ? settings.zoom : null,
    zoomSupported: zoomRange !== null,
    torchSupported: capabilities.torch === true,
    torchEnabled: settings.torch === true,
  };
}

export async function setBarcodeTorch(
  track: MediaStreamTrack,
  enabled: boolean,
): Promise<CameraDiagnostics> {
  let capabilities: CapabilityBag = {};
  try {
    capabilities = asCapabilityBag(track.getCapabilities());
  } catch {
    capabilities = {};
  }

  if (capabilities.torch !== true) return readCameraDiagnostics(track);

  const base = track.getConstraints();
  const { advanced: _ignored, ...baseWithoutAdvanced } = base;
  try {
    await track.applyConstraints({
      ...baseWithoutAdvanced,
      advanced: [{ torch: enabled }],
    } as MediaTrackConstraints);
  } catch {
    // Torch is optional; never break scanning when it is unavailable.
  }

  return readCameraDiagnostics(track);
}

export async function openBarcodeCamera(): Promise<{
  stream: MediaStream;
  track: MediaStreamTrack;
  diagnostics: CameraDiagnostics;
}> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("camera_not_supported");
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(getBarcodeCameraConstraints());
  } catch (firstError) {
    // Some mobile browsers reject a rich profile instead of selecting the closest
    // possible mode. Retry with a deliberately permissive environment-camera profile.
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30, max: 30 },
        },
      });
    } catch {
      throw firstError;
    }
  }

  const track = stream.getVideoTracks()[0];
  if (!track) {
    stream.getTracks().forEach((item) => item.stop());
    throw new Error("camera_track_missing");
  }

  const diagnostics = await configureBarcodeCamera(track);
  return { stream, track, diagnostics };
}
