import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../api/endpoints";
import { isBackendUnreachable } from "../api/client";
import type { OcrDraftDto, OcrJobDto } from "../api/types";
import {
  RECEIPT_POLL_INTERVAL_MS,
  beginReceiptUpload,
  failReceiptScan,
  initialReceiptScan,
  receiptUploaded,
  resolveReceiptDraft,
  resolveReceiptJob,
  shouldKeepPolling,
  type ReceiptScanModel,
} from "../domain/receipt-scan";
import type { ReceiptLine } from "../domain/shopping-checkout";

export interface UseReceiptScanResult {
  model: ReceiptScanModel;
  lines: ReceiptLine[];
  draftId: string | null;
  scan: (file: File) => Promise<void>;
  /** Rejects the open draft (best effort) and returns to IDLE. */
  discard: () => Promise<void>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * Receipt OCR: POST /ocr/jobs (type=receipt) -> poll GET /ocr/jobs/{id} -> GET /ocr/drafts/{id}.
 * Nothing is applied here: a draft never mutates pantry state until the person confirms it
 * (docs/FLOWS.md §6).
 */
export function useReceiptScan(familyId: string | null | undefined): UseReceiptScanResult {
  const [model, setModel] = useState<ReceiptScanModel>(initialReceiptScan());
  const [lines, setLines] = useState<ReceiptLine[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const runRef = useRef(0);
  const draftRef = useRef<string | null>(null);

  useEffect(() => () => { runRef.current += 1; }, []);

  const scan = useCallback(async (file: File) => {
    const run = ++runRef.current;
    const alive = () => runRef.current === run;
    setLines([]);
    setDraftId(null);
    draftRef.current = null;

    let current = beginReceiptUpload(file);
    setModel(current);
    if (current.state !== "UPLOADING") return;
    if (!familyId) {
      setModel(failReceiptScan(current, "ERROR"));
      return;
    }

    try {
      const job = await api.createOcrJob({ familyId, type: "receipt", file });
      if (!alive()) return;
      current = receiptUploaded(current, job.jobId);
      setModel(current);

      while (alive() && shouldKeepPolling(current)) {
        await sleep(RECEIPT_POLL_INTERVAL_MS);
        if (!alive()) return;
        const snapshot = (await api.getOcrJob(job.jobId)) as OcrJobDto;
        if (!alive()) return;
        current = resolveReceiptJob(current, snapshot);
        setModel(current);
      }

      if (alive() && current.state === "PROCESSING" && current.draftId !== undefined) {
        const draft = (await api.getOcrDraft(current.draftId)) as OcrDraftDto;
        if (!alive()) return;
        draftRef.current = draft.draftId;
        setDraftId(draft.draftId);
        const mapped: ReceiptLine[] = draft.items.map((item) => ({
          name: item.name,
          barcode: item.barcode,
          quantity: item.quantity,
          unit: item.unit,
          priceMinor: item.priceMinor,
          currency: item.currency,
          confidence: item.confidence,
          productId: item.productId ?? null,
        }));
        setLines(mapped);
        setModel(resolveReceiptDraft(current, mapped.length));
      }
    } catch (error) {
      if (!alive()) return;
      setModel(failReceiptScan(current, isBackendUnreachable(error) ? "OFFLINE" : "ERROR"));
    }
  }, [familyId]);

  const discard = useCallback(async () => {
    runRef.current += 1;
    const open = draftRef.current;
    draftRef.current = null;
    setDraftId(null);
    setLines([]);
    setModel(initialReceiptScan());
    if (open) await api.rejectOcrDraft(open).catch(() => undefined);
  }, []);

  return { model, lines, draftId, scan, discard };
}
