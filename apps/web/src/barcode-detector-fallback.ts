import { BrowserMultiFormatOneDReader } from "@zxing/browser";

/**
 * Desktop fallback for browsers that expose no native BarcodeDetector.
 *
 * The existing scanner pipeline already preprocesses every frame to a canvas and
 * then calls BarcodeDetector.detect(). Instead of duplicating that pipeline, this
 * adapter exposes the same small API backed by ZXing's 1D reader.
 */
if (typeof window !== "undefined" && !("BarcodeDetector" in window)) {
  class ZXingBarcodeDetector {
    private readonly reader = new BrowserMultiFormatOneDReader();

    async detect(source: ImageBitmapSource): Promise<Array<{ rawValue: string; format?: string }>> {
      if (!(source instanceof HTMLCanvasElement)) return [];

      try {
        const result = this.reader.decodeFromCanvas(source);
        const rawValue = result.getText().trim();
        return rawValue ? [{ rawValue }] : [];
      } catch {
        return [];
      }
    }
  }

  Object.defineProperty(window, "BarcodeDetector", {
    configurable: true,
    value: ZXingBarcodeDetector,
  });
}
