import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { HttpOffLookupClient } from "../src/catalog/external-barcode-client.js";

let server: Server;
let baseUrl = "";
let mode: "success" | "404" | "503" | "malformed" | "slow" = "success";
let requests = 0;

before(async () => {
  server = createServer((req, res) => {
    requests += 1;
    if (mode === "404") {
      res.statusCode = 404;
      res.end();
      return;
    }
    if (mode === "503") {
      res.statusCode = 503;
      res.end();
      return;
    }
    if (mode === "malformed") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end("{broken");
      return;
    }
    if (mode === "slow") {
      setTimeout(() => {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({
          code: "8001234567890",
          source: "cache",
          product: { product_name_it: "Latte", quantity: "1 L", brands: "Marca", categories_tags: ["en:dairies"] },
        }));
      }, 100);
      return;
    }
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      code: "8001234567890",
      source: "cache",
      product: {
        product_name_it: "Latte intero",
        brands: "Marca, altra",
        quantity: "1 L",
        image_front_url: "https://example.test/latte.jpg",
        categories_tags: ["en:dairies"],
        nutriments: {
          "energy-kcal_100g": 62,
          "proteins_100g": 3.2,
          "carbohydrates_100g": 4.8,
          "fat_100g": 3.5,
          "fiber_100g": 0,
        },
      },
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

describe("service-catalog / HTTP Open Food Facts boundary", () => {
  beforeEach(() => {
    mode = "success";
    requests = 0;
  });

  it("parses a real HTTP cache response", async () => {
    const client = new HttpOffLookupClient({ baseUrl, timeoutMs: 500 });
    const result = await client.lookup({
      identifierType: "BARCODE",
      normalizedValue: "8001234567890",
      traceId: "trace-123456789",
    });

    assert.ok(result);
    assert.equal(result.canonicalName, "Latte intero");
    assert.equal(result.brand, "Marca");
    assert.equal(result.defaultUnit, "l");
    assert.equal(result.category, "eggs-dairy");
    assert.equal(result.sourceVersion, "off-dump-v1");
    assert.equal(result.calories, 62);
    assert.equal(result.protein, 3.2);
  });

  it("treats 404 as a clean miss and resets failures", async () => {
    mode = "404";
    const client = new HttpOffLookupClient({
      baseUrl,
      timeoutMs: 500,
      circuitBreakThreshold: 2,
    });
    const result = await client.lookup({
      identifierType: "BARCODE",
      normalizedValue: "8001234567890",
      traceId: "trace-123456789",
    });
    assert.equal(result, undefined);
    assert.equal(requests, 1);
  });

  it("treats provider 503 as a transient failure and opens the circuit", async () => {
    mode = "503";
    let now = 0;
    const client = new HttpOffLookupClient({
      baseUrl,
      timeoutMs: 500,
      circuitBreakThreshold: 2,
      circuitResetMs: 10_000,
      now: () => now,
    });

    await client.lookup({ identifierType: "BARCODE", normalizedValue: "8001234567890", traceId: "trace-123456789" });
    await client.lookup({ identifierType: "BARCODE", normalizedValue: "8001234567890", traceId: "trace-123456789" });
    const afterOpen = requests;
    await client.lookup({ identifierType: "BARCODE", normalizedValue: "8001234567890", traceId: "trace-123456789" });

    assert.equal(afterOpen, 2);
    assert.equal(requests, 2);

    now = 10_001;
    mode = "success";
    const recovered = await client.lookup({
      identifierType: "BARCODE",
      normalizedValue: "8001234567890",
      traceId: "trace-123456789",
    });
    assert.ok(recovered);
  });

  it("degrades on malformed JSON", async () => {
    mode = "malformed";
    const client = new HttpOffLookupClient({ baseUrl, timeoutMs: 500 });
    const result = await client.lookup({
      identifierType: "BARCODE",
      normalizedValue: "8001234567890",
      traceId: "trace-123456789",
    });
    assert.equal(result, undefined);
  });

  it("enforces the hard timeout without hanging", async () => {
    mode = "slow";
    const client = new HttpOffLookupClient({ baseUrl, timeoutMs: 10, circuitBreakThreshold: 5 });
    const started = Date.now();
    const result = await client.lookup({
      identifierType: "BARCODE",
      normalizedValue: "8001234567890",
      traceId: "trace-123456789",
    });
    const elapsed = Date.now() - started;
    assert.equal(result, undefined);
    assert.ok(elapsed < 250);
  });
});
