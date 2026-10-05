# Barcode CV pipeline

## Scope

The barcode scanner is implemented at the mobile/web edge in `apps/web`. The catalog
lookup remains server-side and is reached only after a barcode has passed normalization,
GS1 check-digit validation and temporal consensus.

This is intentionally a **confidence pipeline**, not a single decoder call.

## End-to-end flow

```
Camera 60 fps
   |
   +--> continuous AF + center point-of-interest + torch/zoom capability
   |
ROI/viewfinder crop
   |
quality gate: sharpness + contrast + motion + clipping + luminance
   |
adaptive decoder cadence (~90 ms minimum between decode attempts)
   |
+---------------- decoder ensemble ----------------+
| raw | equalized | CLAHE | Sauvola | Bradley | 2x |
+--------------------------------------------------+
   |
native BarcodeDetector + ZXing fallback
   |
candidate aggregation
   |
GS1 checksum + symbology priority + spatial consistency
   |
temporal consensus (3 good / 4 difficult frames)
   |
normalizeProductBarcode()
   |
resolveProductBarcode("BARCODE", GTIN)
   |
service-catalog -> off-lookup/search-indexer
```

## Important correctness rule

A valid checksum is **necessary but not sufficient**. For example, both:

- `8003440108888` (EAN-13)
- `043000108888` (UPC-A)

are checksum-valid strings.

Therefore the scanner must not accept the first checksum-valid decoder result. It now
aggregates all decoder variants and ranks candidates using:

1. checksum validity;
2. retail symbology priority (EAN-13 > GTIN-14 > UPC-A > EAN-8);
3. number of independent preprocessing/decoder observations;
4. spatial proximity to the viewfinder centre;
5. temporal agreement across consecutive frames.

This directly prevents a decoder's first UPC-A hallucination from immediately winning over
an EAN-13 candidate.

## Adaptive preprocessing

The pipeline uses:

- grayscale conversion;
- global histogram equalization for cheap recovery;
- tile-based CLAHE approximation for spatially varying illumination;
- Sauvola local thresholding:
  `T = m * (1 + k * (s/R - 1))`;
- Bradley local thresholding using an integral image;
- light unsharp masking and 2x upscaling.

Otsu is not used as the only threshold because it assumes a useful global separation of
foreground/background. A specular highlight or strong shadow can make one global threshold
invalid across the barcode.

## Camera strategy

The browser requests:

- rear/environment camera;
- up to 2560x1440 when supported;
- 60 fps acquisition when supported;
- continuous autofocus;
- central focus point;
- `resizeMode=none` when supported;
- modest automatic zoom;
- torch as an explicit fallback.

Actual device capabilities always win. A browser cannot force optical focus, exposure or
NPU execution if the platform does not expose those controls.

## Mobile performance

The acquisition stream can run at 60 fps while decoding is throttled independently.
Quality analysis runs on a small ROI and decoding starts at a 90 ms minimum interval, avoiding
a full preprocessing/ZXing pass on every camera frame.

This separation is important: **60 fps camera acquisition is not the same thing as 60 full
decodes per second**.

## Limitations

The current repository is a browser/TypeScript implementation. It does **not** yet contain
an INT8 YOLO/OBB model, native C++ OpenCV pipeline, GPU/NPU delegate, cylindrical
unwarping model, or multi-frame image stitcher. Those cannot be honestly claimed to exist
just by adding preprocessing to a browser decoder.

For a true commercial-scanner target, the next stage is a native mobile scanner module
(Android CameraX/Media3 + C++/OpenCV + ZXing-C++ or ML Kit/AVFoundation on iOS) with an
INT8 detector and platform-specific GPU/NPU delegates.

## Edge-case test matrix

| Case | Expected strategy | Pass condition |
|---|---|---|
| clean EAN-13 | raw/native | correct GTIN, checksum valid |
| clean UPC-A | raw/native | correct UPC-A |
| strong shadow | CLAHE/Sauvola/Bradley | decode remains stable |
| specular plastic glare | CLAHE + multi-frame | no transient wrong GTIN |
| dark scene | torch + exposure/focus recovery | stable candidate |
| 60 fps motion | quality gate + temporal consensus | no false early accept |
| 75° inclination | ROI + decoder geometry | correct code or explicit retry |
| cylindrical package | multiple views/frames | no false GTIN |
| partial occlusion | temporal observations | accept only if evidence is sufficient |
| damaged print | adaptive thresholding | no invalid candidate |
| EAN-13 vs UPC-A confusion | candidate aggregation | EAN-13 wins when observed |
| repeated wrong checksum-valid code | temporal + spatial consensus | no immediate acceptance |
| no barcode | all variants | manual path |
| camera focus failure | focus recovery | user receives actionable state |
| unavailable torch/zoom | capability fallback | scanning continues |

## Acceptance targets

The product requirement of <50 ms decode latency and >99.9% accuracy must be treated as a
**benchmark target**, not an assumption. It requires measurements on the target phone fleet.
The browser implementation should report p50/p95 decode latency, false-positive rate,
false-negative rate and thermal behaviour before those targets are claimed.
