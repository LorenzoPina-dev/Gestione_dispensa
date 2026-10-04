import assert from "node:assert/strict";
import test from "node:test";
import { MongoClient, type Collection } from "mongodb";
import {
  defaultDerivationOptions,
  derivedImageFields,
} from "../src/off-derived.js";

type Product = Record<string, unknown>;

const enabled = process.env.OFF_LOOKUP_IMAGE_INTEGRATION === "1";
const mongoUrl = process.env.OFF_LOOKUP_MONGO_URL?.trim() ?? "";
const mongoDb = process.env.OFF_LOOKUP_MONGO_DB?.trim() || "off";
const mongoCollection = process.env.OFF_LOOKUP_MONGO_COLLECTION?.trim() || "products";
const apiBaseUrl = (process.env.OFF_LOOKUP_API_BASE_URL?.trim() || "https://world.openfoodfacts.org").replace(/\/+$/, "");
const maxProducts = Math.min(Math.max(Number(process.env.OFF_LOOKUP_IMAGE_TEST_LIMIT ?? 10), 1), 25);

interface ApiProductResponse {
  readonly status?: string | number;
  readonly product?: Product;
}

function urlPath(value: unknown): string | null {
  if (typeof value !== "string" || !/^https?:\/\//i.test(value)) return null;
  try {
    return new URL(value).pathname;
  } catch {
    return null;
  }
}

function sameImagePath(localUrl: string, apiUrl: unknown): boolean {
  const localPath = urlPath(localUrl);
  const apiPath = urlPath(apiUrl);
  return localPath !== null && apiPath !== null && localPath === apiPath;
}

async function fetchOffProduct(code: string): Promise<Product | null> {
  const url =
    `${apiBaseUrl}/api/v3/product/${encodeURIComponent(code)}.json?product_type=food&lc=it&generate_images_urls=1`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "GestioneDispensa-OffImageIntegrationTest/1.0",
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`OFF API ${response.status} for ${code}`);
  }

  const body = await response.json() as ApiProductResponse;
  const product = body.product;
  return body.status === "success" || body.status === 1
    ? product ?? null
    : null;
}

async function checkHttp(url: string): Promise<number> {
  const head = await fetch(url, {
    method: "HEAD",
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
    headers: { "User-Agent": "GestioneDispensa-OffImageIntegrationTest/1.0" },
  });

  if (head.status !== 405) return head.status;

  const get = await fetch(url, {
    method: "GET",
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
    headers: {
      Range: "bytes=0-0",
      "User-Agent": "GestioneDispensa-OffImageIntegrationTest/1.0",
    },
  });
  await get.body?.cancel();
  return get.status;
}

test(
  "Mongo -> local OFF image URL -> live API -> HTTP round-trip",
  { skip: !enabled },
  async () => {
    assert.ok(mongoUrl, "OFF_LOOKUP_MONGO_URL is required when integration test is enabled");

    const client = new MongoClient(mongoUrl, {
      serverSelectionTimeoutMS: 10_000,
      connectTimeoutMS: 10_000,
    });

    const failures: string[] = [];
    let checked = 0;

    try {
      await client.connect();
      const collection = client.db(mongoDb).collection<Product>(mongoCollection);

      const cursor = collection.find(
        {
          code: { $type: "string", $regex: /^\\d{8,14}$/ },
          $or: [
            { "images.selected.front": { $exists: true } },
            { "selected_images.front": { $exists: true } },
            { "images.front": { $exists: true } },
            { "images.front_it": { $exists: true } },
          ],
        },
        {
          projection: {
            _id: 0,
            code: 1,
            lang: 1,
            lc: 1,
            images: 1,
            selected_images: 1,
          },
        },
      ).limit(maxProducts * 5);

      for await (const product of cursor) {
        if (checked >= maxProducts) break;

        const code = typeof product.code === "string" ? product.code.trim() : "";
        if (!/^\\d{8,14}$/.test(code)) continue;

        const derived = derivedImageFields(code, product, defaultDerivationOptions());
        const localUrl = derived.image_front_url;
        if (!localUrl) continue;

        checked += 1;

        try {
          const apiProduct = await fetchOffProduct(code);
          if (!apiProduct) {
            failures.push(`${code}: OFF API returned no product`);
            continue;
          }

          const apiUrl =
            apiProduct.image_front_url ??
            apiProduct.image_front_small_url ??
            apiProduct.image_front_thumb_url;

          if (!sameImagePath(localUrl, apiUrl)) {
            failures.push(
              `${code}: local path ${urlPath(localUrl)} != API path ${urlPath(apiUrl)}; local=${localUrl}; api=${String(apiUrl)}`,
            );
            continue;
          }

          const localStatus = await checkHttp(localUrl);
          if (localStatus < 200 || localStatus >= 400) {
            failures.push(`${code}: local image HTTP ${localStatus}: ${localUrl}`);
          }

          if (typeof apiUrl === "string") {
            const apiStatus = await checkHttp(apiUrl);
            if (apiStatus < 200 || apiStatus >= 400) {
              failures.push(`${code}: API image HTTP ${apiStatus}: ${apiUrl}`);
            }
          }
        } catch (error) {
          failures.push(`${code}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      assert.ok(
        checked > 0,
        "No Mongo products with a derivable front image were found. Check the dump/schema and Mongo configuration.",
      );
      assert.deepEqual(
        failures,
        [],
        `OFF image round-trip failed for ${checked} product(s):\\n${failures.join("\\n")}`,
      );
    } finally {
      await client.close();
    }
  },
);
