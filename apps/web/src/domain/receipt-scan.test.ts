import assert from "node:assert/strict";
import test from "node:test";
import {
  RECEIPT_MAX_POLLS,
  beginReceiptUpload,
  failReceiptScan,
  initialReceiptScan,
  receiptUploaded,
  resolveReceiptDraft,
  resolveReceiptJob,
  shouldKeepPolling,
} from "./receipt-scan.js";

const uploading = () => beginReceiptUpload({ size: 1000, type: "image/jpeg" });

test("unsupported or oversized files fail before any upload", () => {
  assert.equal(beginReceiptUpload({ size: 10, type: "application/pdf" }).state, "FAILED");
  assert.equal(beginReceiptUpload({ size: 11 * 1024 * 1024, type: "image/png" }).state, "FAILED");
  assert.equal(uploading().state, "UPLOADING");
});

test("queued jobs keep polling until a draft id appears", () => {
  let model = receiptUploaded(uploading(), "job-1");
  assert.equal(shouldKeepPolling(model), true);
  model = resolveReceiptJob(model, { status: "processing", progress: 40, draftId: null, error: null });
  assert.equal(model.progress, 40);
  assert.equal(shouldKeepPolling(model), true);
  model = resolveReceiptJob(model, { status: "needs_review", progress: 100, draftId: "d-1", error: null });
  assert.equal(model.draftId, "d-1");
  assert.equal(shouldKeepPolling(model), false);
  assert.equal(resolveReceiptDraft(model, 3).state, "READY");
});

test("a draft without items, or a finished job without draft, needs manual review", () => {
  const base = receiptUploaded(uploading(), "job-1");
  const withDraft = resolveReceiptJob(base, { status: "needs_review", progress: 100, draftId: "d", error: null });
  assert.equal(resolveReceiptDraft(withDraft, 0).state, "MANUAL_REQUIRED");
  assert.equal(resolveReceiptJob(base, { status: "completed", progress: 100, draftId: null, error: null }).state, "MANUAL_REQUIRED");
});

test("polling is bounded", () => {
  let model = receiptUploaded(uploading(), "job-1");
  for (let i = 0; i < RECEIPT_MAX_POLLS; i += 1) {
    model = resolveReceiptJob(model, { status: "queued", progress: 0, draftId: null, error: null });
  }
  assert.equal(model.state, "MANUAL_REQUIRED");
});

test("failures are explicit", () => {
  assert.equal(resolveReceiptJob(receiptUploaded(uploading(), "j"), { status: "failed", progress: 100, draftId: null, error: "X" }).state, "FAILED");
  assert.equal(failReceiptScan(initialReceiptScan(), "OFFLINE").state, "OFFLINE");
  assert.equal(failReceiptScan(initialReceiptScan(), "ERROR").state, "FAILED");
});
