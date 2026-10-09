import assert from "node:assert/strict";
import test from "node:test";
import {
  choosePreferredBarcodeCamera,
  scoreBarcodeCameraLabel,
} from "./barcode-camera.js";

test("prefers a rear/main camera over front and telephoto labels", () => {
  assert.ok(scoreBarcodeCameraLabel("Back Camera") > scoreBarcodeCameraLabel("Front Camera"));
  assert.ok(scoreBarcodeCameraLabel("Rear Main Camera") > scoreBarcodeCameraLabel("Rear Telephoto"));
});

test("keeps the current camera when labels are uninformative", () => {
  const current = "current";
  assert.equal(
    choosePreferredBarcodeCamera(
      [
        { deviceId: current, label: "USB Camera" },
        { deviceId: "other", label: "USB Camera 2" },
      ],
      current,
    ),
    current,
  );
});

test("switches when a materially better rear/main candidate is available", () => {
  assert.equal(
    choosePreferredBarcodeCamera(
      [
        { deviceId: "current", label: "Front Camera" },
        { deviceId: "rear", label: "Rear Main Camera" },
      ],
      "current",
    ),
    "rear",
  );
});
