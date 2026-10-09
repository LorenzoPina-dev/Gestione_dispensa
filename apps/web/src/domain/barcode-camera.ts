/**
 * Camera selection policy.
 *
 * Browser camera labels are not standardized enough to guarantee the physical
 * "main" lens, so this is intentionally a heuristic. The live track settings
 * remain the authority on the camera actually selected.
 */

export type CameraDeviceLike = {
  deviceId: string;
  label: string;
  kind?: string;
};

export function scoreBarcodeCameraLabel(label: string): number {
  const value = label.trim().toLowerCase();
  let score = 0;

  if (/front|user|facetime|integrated.*front/.test(value)) score -= 20;
  if (/ultra.?wide|ultrawide/.test(value)) score -= 8;
  if (/telephoto|telephoto|tele|zoom/.test(value)) score -= 6;
  if (/depth|tof|infrared|ir/.test(value)) score -= 8;

  if (/back|rear|environment|posteriore|retro/.test(value)) score += 16;
  if (/main|primary|wide|1x/.test(value)) score += 7;
  if (/camera/.test(value)) score += 1;

  return score;
}

export function choosePreferredBarcodeCamera(
  devices: readonly CameraDeviceLike[],
  currentDeviceId?: string | null,
): string | null {
  const videoDevices = devices.filter(
    (device) => (!device.kind || device.kind === "videoinput") && device.deviceId,
  );
  if (videoDevices.length === 0) return currentDeviceId ?? null;

  const ranked = [...videoDevices].sort((a, b) => {
    const scoreDiff = scoreBarcodeCameraLabel(b.label) - scoreBarcodeCameraLabel(a.label);
    if (scoreDiff !== 0) return scoreDiff;
    return a.deviceId.localeCompare(b.deviceId);
  });

  const best = ranked[0];
  const current = videoDevices.find((device) => device.deviceId === currentDeviceId);
  if (!current) return best.deviceId;

  const currentScore = scoreBarcodeCameraLabel(current.label);
  const bestScore = scoreBarcodeCameraLabel(best.label);

  return bestScore >= currentScore + 3 ? best.deviceId : current.deviceId;
}
