import { choosePreferredBarcodeCamera } from "../domain/barcode-camera.js";

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
const TARGET_FPS = 60;
const AUTO_ZOOM = 1.25;

const ZOOM_RECOVERY_STEP = 0.5;
const FOCUS_RECOVERY_DELAY_MS = 90;


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
        advanced: [...applied, patch] as unknown as MediaTrackConstraintSet[],
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

  // Image Capture constraints (focusMode, zoom, torch, POI, resizeMode) are
  // not present in older TypeScript DOM declarations even when the browser supports them.
  const supported = (navigator.mediaDevices.getSupportedConstraints?.() ?? {}) as Record<string, boolean>;
  const patches: Record<string, unknown>[] = [];

  if (
    supported.focusMode &&
    stringList(capabilities.focusMode).includes("continuous")
  ) {
    patches.push({ focusMode: "continuous" });
  }

  // Point-of-interest is optional. Keep it separate from focusMode so a browser
  // that rejects POI does not accidentally disable continuous autofocus.
  if (supported.pointsOfInterest) {
    patches.push({
      pointsOfInterest: [{ x: 0.5, y: 0.5 } as PointOfInterest],
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
  const settingsBag = settings as Record<string, unknown>;
  const currentZoom =
    typeof settingsBag.zoom === "number" ? settingsBag.zoom : zoomRange?.min ?? null;

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
  const settingsBag = settings as Record<string, unknown>;

  return {
    width: settings.width ?? 0,
    height: settings.height ?? 0,
    frameRate: settings.frameRate ?? null,
    aspectRatio: settings.aspectRatio ?? null,
    facingMode: settings.facingMode ?? null,
    deviceId: settings.deviceId ?? null,
    focusMode: typeof settingsBag.focusMode === "string" ? settingsBag.focusMode : null,
    continuousFocus: focusModes.includes("continuous") || settingsBag.focusMode === "continuous",
    zoom: typeof settingsBag.zoom === "number" ? settingsBag.zoom : null,
    zoomSupported: zoomRange !== null,
    torchSupported: capabilities.torch === true,
    torchEnabled: settingsBag.torch === true,
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
  const currentAdvanced = Array.isArray(base.advanced)
    ? (base.advanced as unknown as Record<string, unknown>[])
    : [];
  const preservedAdvanced = currentAdvanced.filter((item) => !("torch" in item));

  try {
    await track.applyConstraints({
      ...base,
      advanced: [...preservedAdvanced, { torch: enabled }] as unknown as MediaTrackConstraintSet[],
    } as MediaTrackConstraints);
  } catch {
    // Torch is optional; never break scanning when it is unavailable.
  }

  return readCameraDiagnostics(track);
}

async function requestBarcodeCamera(
  constraints: MediaStreamConstraints,
): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia(constraints);
}

async function selectPreferredEnvironmentCamera(
  currentDeviceId: string | null,
): Promise<string | null> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return choosePreferredBarcodeCamera(
      devices
        .filter((device) => device.kind === "videoinput")
        .map((device) => ({
          deviceId: device.deviceId,
          label: device.label,
          kind: device.kind,
        })),
      currentDeviceId,
    );
  } catch {
    return currentDeviceId;
  }
}

async function requestPreferredCamera(
  deviceId: string,
): Promise<MediaStream | null> {
  try {
    return await requestBarcodeCamera({
      audio: false,
      video: {
        ...HIGH_QUALITY_VIDEO_CONSTRAINTS,
        deviceId: { exact: deviceId },
      },
    });
  } catch {
    try {
      return await requestBarcodeCamera({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          deviceId: { exact: deviceId },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: TARGET_FPS, max: TARGET_FPS },
        },
      });
    } catch {
      return null;
    }
  }
}

export async function recoverBarcodeFocus(
  track: MediaStreamTrack,
): Promise<CameraDiagnostics> {
  let capabilities: CapabilityBag = {};
  try {
    capabilities = asCapabilityBag(track.getCapabilities());
  } catch {
    return readCameraDiagnostics(track);
  }

  const supported = (navigator.mediaDevices.getSupportedConstraints?.() ?? {}) as Record<string, boolean>;
  const focusModes = stringList(capabilities.focusMode);

  if (!supported.focusMode) return readCameraDiagnostics(track);

  if (focusModes.includes("single-shot") && focusModes.includes("continuous")) {
    await applyPatchSafely(track, [{ focusMode: "single-shot" }]);
    await new Promise((resolve) => window.setTimeout(resolve, FOCUS_RECOVERY_DELAY_MS));
    await applyPatchSafely(track, [{ focusMode: "continuous" }]);
  } else if (focusModes.includes("continuous")) {
    await applyPatchSafely(track, [{ focusMode: "continuous" }]);
  } else {
    return readCameraDiagnostics(track);
  }

  if (supported.pointsOfInterest) {
    await applyPatchSafely(track, [{ pointsOfInterest: [{ x: 0.5, y: 0.5 } as PointOfInterest] }]);
  }

  return readCameraDiagnostics(track);
}

export async function increaseBarcodeZoom(
  track: MediaStreamTrack,
  step = ZOOM_RECOVERY_STEP,
): Promise<CameraDiagnostics> {
  let capabilities: CapabilityBag = {};
  try {
    capabilities = asCapabilityBag(track.getCapabilities());
  } catch {
    return readCameraDiagnostics(track);
  }

  const supported = (navigator.mediaDevices.getSupportedConstraints?.() ?? {}) as Record<string, boolean>;
  const zoomRange = numericRange(capabilities.zoom);
  if (!zoomRange || supported.zoom === false) return readCameraDiagnostics(track);

  const settingsBag = track.getSettings() as Record<string, unknown>;
  const current =
    typeof settingsBag.zoom === "number" ? settingsBag.zoom : zoomRange.min;
  const target = clampToStep(current + Math.max(0.1, step), zoomRange);
  if (target <= current) return readCameraDiagnostics(track);

  await applyPatchSafely(track, [{ zoom: target }]);
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
    stream = await requestBarcodeCamera(getBarcodeCameraConstraints());
  } catch (firstError) {
    try {
      stream = await requestBarcodeCamera({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: TARGET_FPS, max: TARGET_FPS },
        },
      });
    } catch {
      throw firstError;
    }
  }

  let track = stream.getVideoTracks()[0];
  if (!track) {
    stream.getTracks().forEach((item) => item.stop());
    throw new Error("camera_track_missing");
  }

  await configureBarcodeCamera(track);

  // Permission is already granted at this point, so labels become useful for
  // selecting a likely rear/main lens instead of blindly trusting facingMode.
  const currentDeviceId = track.getSettings().deviceId ?? null;
  const preferredDeviceId = await selectPreferredEnvironmentCamera(currentDeviceId);
  if (preferredDeviceId && preferredDeviceId !== currentDeviceId) {
    const preferredStream = await requestPreferredCamera(preferredDeviceId);
    const preferredTrack = preferredStream?.getVideoTracks()[0];
    if (preferredStream && preferredTrack) {
      stream.getTracks().forEach((item) => item.stop());
      stream = preferredStream;
      track = preferredTrack;
      await configureBarcodeCamera(track);
    } else {
      preferredStream?.getTracks().forEach((item) => item.stop());
    }
  }

  const diagnostics = readCameraDiagnostics(track);
  return { stream, track, diagnostics };
}
