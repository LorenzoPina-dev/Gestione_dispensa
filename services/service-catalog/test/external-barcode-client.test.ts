import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { HttpOffLookupClient } from "../src/catalog/external-barcode-client.js";

let server: Server;
let baseUrl = "";
let mode: "success" | "candy" | "404" | "503" | "malformed" | "slow" = "success";
let requests = 0;

before(async () => {
  server = createServer((req, res) => {
    if (req.url?.startsWith("/api/v1/search")) {
      requests += 1;
      if (req.headers.authorization !== "Bearer internal-test-token") {
        res.statusCode = 401;
        res.end();
        return;
      }
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        source: "local",
        items: [{
          code: "8001234567890",
          product: {
            product_name_it: "Latte",
            brands: "Marca",
            quantity: "90 g",
            categories_tags: ["en:dairies"],
          },
        }],
      }));
      return;
    }
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
    if (mode === "candy") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        code: "8003440108888",
        source: "cache",
        product: {
          product_name_it: "Golia Activ Plus Senza Zucchero",
          brands: "Perfetti",
          quantity: "90 g",
          product_quantity: 90,
          product_quantity_unit: "g",
          categories_tags: ["it:caramelle"],
        },
      }));
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
        quantity: "90 g",
        image_front_url: "https://example.test/latte.jpg",
        image_ingredients_url: "https://example.test/ingredients.jpg",
        categories_tags: ["en:dairies"],
        ingredients_text: "Milk, cream",
        allergens_tags: ["en:milk"],
        labels_tags: ["en:organic"],
        nutriscore_grade: "a",
        nova_group: 2,
        serving_size: "3 g",
        serving_quantity: 3,
        serving_quantity_unit: "g",
        product_quantity: 90,
        product_quantity_unit: "g",
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
    assert.equal(result.defaultUnit, "g");
    assert.equal(result.category, "eggs-dairy");
    assert.equal(result.sourceVersion, "off-dump-v1");
    assert.equal(result.sourceRef, "8001234567890");
    assert.equal(result.quantityValue, 90);
    assert.equal(result.quantityUnit, "g");
    assert.equal(result.quantityLabel, "90 g");
    assert.equal(result.servingSize, "3 g");
    assert.equal(result.servingQuantity, 3);
    assert.equal(result.servingUnit, "g");
    assert.equal(result.calories, 62);
    assert.equal(result.protein, 3.2);
    assert.equal(result.images?.front, "https://example.test/latte.jpg");
    assert.equal(result.images?.ingredients, "https://example.test/ingredients.jpg");
    assert.equal((result.openFoodFacts?.ingredients_text as string), "Milk, cream");
    assert.deepEqual(result.openFoodFacts?.allergens_tags, ["en:milk"]);
    assert.equal(result.openFoodFacts?.nutriscore_grade, "a");
  });

  it("authenticates the internal search boundary", async () => {
    mode = "success";
    const client = new HttpOffLookupClient({ baseUrl, timeoutMs: 500, internalToken: "internal-test-token" });
    const result = await client.search({ query: "latte", limit: 8, traceId: "trace-search" });
    assert.ok(result);
    assert.equal(result.length, 1);
    assert.equal(requests, 1);
  });

  it("classifies Italian confectionery products for shelf-life", async () => {
    mode = "candy";
    const client = new HttpOffLookupClient({ baseUrl, timeoutMs: 500 });
    const result = await client.lookup({
      identifierType: "BARCODE",
      normalizedValue: "8003440108888",
      traceId: "trace-123456789",
    });
    assert.ok(result);
    assert.equal(result.category, "confectionery-candy");
    assert.equal(result.quantityValue, 90);
    assert.equal(result.quantityUnit, "g");
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
