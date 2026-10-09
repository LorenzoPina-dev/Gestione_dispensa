import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deriveProductFields,
  imageUrl,
  isRequiredFieldMissing,
  localizedText,
  productImagePath,
  resolveImages,
  type DerivationOptions,
} from "../src/off-derived.js";

const OPTIONS: DerivationOptions = {
  imagesBaseUrl: "https://img.test/images/products",
  languages: ["it", "en"],
  imagePolicy: "fill",
  uploadFallback: "none",
};

const CODE = "3017620422003";
const BASE = "https://img.test/images/products/301/762/042/2003";

const FULL_SIZES = {
  "100": { w: 75, h: 100 },
  "200": { w: 150, h: 200 },
  "400": { w: 300, h: 400 },
  full: { w: 900, h: 1200 },
};

describe("productImagePath", () => {
  it("splits barcodes with 9+ digits as 3/3/3/rest and keeps leading zeros", () => {
    assert.equal(productImagePath("3017620422003"), "301/762/042/2003");
    assert.equal(productImagePath("0012345678905"), "001/234/567/8905");
    assert.equal(productImagePath("123456789"), "123/456/789");
    assert.equal(productImagePath(" 3017620422003 "), "301/762/042/2003");
  });

  it("uses the code itself for short barcodes (EAN-8) and rejects non numeric input", () => {
    assert.equal(productImagePath("96385074"), "96385074");
    assert.equal(productImagePath("abc"), null);
    assert.equal(productImagePath(""), null);
  });
});

describe("image URL derivation from persisted metadata", () => {
  it("builds display/small/thumb URLs for the selected front image", () => {
    const { product, derived } = deriveProductFields(CODE, {
      images: { "1": { sizes: FULL_SIZES }, front_it: { imgid: "1", rev: "7", sizes: FULL_SIZES } },
    }, OPTIONS);

    assert.equal(product.image_front_url, `${BASE}/front_it.7.400.jpg`);
    assert.equal(product.image_front_small_url, `${BASE}/front_it.7.200.jpg`);
    assert.equal(product.image_front_thumb_url, `${BASE}/front_it.7.100.jpg`);
    assert.equal(product.image_url, `${BASE}/front_it.7.400.jpg`);
    assert.equal(product.image_small_url, `${BASE}/front_it.7.200.jpg`);
    assert.equal(product.image_thumb_url, `${BASE}/front_it.7.100.jpg`);
    assert.ok(derived.includes("image_front_small_url"));
  });

  it("keeps image METADATA separate from URLs", () => {
    const images = resolveImages({
      images: { front_it: { imgid: "1", rev: 7, sizes: FULL_SIZES } },
    }, OPTIONS);

    assert.deepEqual(
      { ...images.front },
      {
        kind: "front", origin: "selected", key: "front_it", lang: "it",
        imageId: "1", revision: "7", sizes: [100, 200, 400], hasFull: true, width: 900, height: 1200,
      },
    );
    assert.equal(imageUrl(OPTIONS, CODE, images.front!, "full"), `${BASE}/front_it.7.full.jpg`);
  });

  it("only emits sizes that exist: small falls back to 400 when 200 was never generated", () => {
    const { product } = deriveProductFields(CODE, {
      images: { front_it: { rev: "3", sizes: { "100": { w: 1, h: 1 }, "400": { w: 4, h: 4 }, full: { w: 9, h: 9 } } } },
    }, OPTIONS);

    assert.equal(product.image_front_small_url, `${BASE}/front_it.3.400.jpg`);
    assert.equal(product.image_front_thumb_url, `${BASE}/front_it.3.100.jpg`);
  });

  it("accepts numeric revisions and assumes the standard renditions when sizes are not stored", () => {
    const { product } = deriveProductFields(CODE, { images: { front_en: { rev: 12 } } }, OPTIONS);
    assert.equal(product.image_front_url, `${BASE}/front_en.12.400.jpg`);
    assert.equal(product.image_front_small_url, `${BASE}/front_en.12.200.jpg`);
  });

  it("derives other kinds too, but image_url is the FRONT image only", () => {
    const { product } = deriveProductFields(CODE, {
      images: { ingredients_it: { rev: "3", sizes: FULL_SIZES } },
    }, OPTIONS);

    assert.equal(product.image_ingredients_url, `${BASE}/ingredients_it.3.400.jpg`);
    assert.equal(product.image_front_url, undefined);
    assert.equal(product.image_url, undefined);
  });
});

describe("language selection for images", () => {
  it("follows the configured priority, then a language-less key, then alphabetical", () => {
    const pick = (images: Record<string, unknown>, options = OPTIONS) =>
      resolveImages({ images }, options).front?.key;

    assert.equal(pick({ front_en: { rev: "1" }, front_it: { rev: "2" } }), "front_it");
    assert.equal(pick({ front_fr: { rev: "1" }, front_en: { rev: "2" } }), "front_en");
    assert.equal(pick({ front_fr: { rev: "1" }, front: { rev: "2" } }), "front");
    assert.equal(pick({ front_fr: { rev: "1" }, front_de: { rev: "2" } }), "front_de");
  });

  it("falls back to the product's own language after the configured ones", () => {
    const key = resolveImages(
      { lang: "fr", images: { front_de: { rev: "1" }, front_fr: { rev: "2" } } },
      { languages: ["it"], uploadFallback: "none" },
    ).front?.key;
    assert.equal(key, "front_fr");
  });
});

describe("selected_images", () => {
  it("lets an explicit selection ({imgid, rev}) win over images.<key> for the same language", () => {
    const { product } = deriveProductFields(CODE, {
      images: {
        "4": { sizes: FULL_SIZES },
        front_it: { imgid: "2", rev: "5", sizes: FULL_SIZES },
      },
      selected_images: { front: { it: { imgid: "4", rev: "9" } } },
    }, OPTIONS);

    assert.equal(product.image_front_small_url, `${BASE}/front_it.9.200.jpg`);
  });

  it("uses API-shaped URL maps when there is no metadata to build from", () => {
    const { product } = deriveProductFields(CODE, {
      selected_images: {
        front: {
          display: { it: "https://x.test/a.400.jpg" },
          small: { it: "https://x.test/a.200.jpg" },
          thumb: { it: "https://x.test/a.100.jpg" },
        },
      },
    }, OPTIONS);

    assert.equal(product.image_front_small_url, "https://x.test/a.200.jpg");
    assert.equal(product.image_front_thumb_url, "https://x.test/a.100.jpg");
  });
});

describe("derivation policy", () => {
  const withMetadata = {
    image_front_small_url: "https://old.test/stale.jpg",
    images: { front_it: { rev: "7", sizes: FULL_SIZES } },
  };

  it("fill: stored URLs win, only missing ones are derived", () => {
    const { product } = deriveProductFields(CODE, withMetadata, OPTIONS);
    assert.equal(product.image_front_small_url, "https://old.test/stale.jpg");
    assert.equal(product.image_front_url, `${BASE}/front_it.7.400.jpg`);
  });

  it("prefer: derived URLs replace stored ones", () => {
    const { product, derived } = deriveProductFields(CODE, withMetadata, { ...OPTIONS, imagePolicy: "prefer" });
    assert.equal(product.image_front_small_url, `${BASE}/front_it.7.200.jpg`);
    assert.ok(derived.includes("image_front_small_url"));
  });

  it("returns the very same object when nothing can be derived", () => {
    const input = { product_name: "Latte", images: { front: "legacy.jpg" } };
    const result = deriveProductFields(CODE, input, OPTIONS);
    assert.equal(result.product, input);
    assert.deepEqual(result.derived, []);
  });
});

describe("uploaded (not selected) images", () => {
  const uploads = {
    images: {
      "1": { uploaded_t: 100, sizes: { "100": { w: 1, h: 1 }, "400": { w: 4, h: 4 }, full: { w: 9, h: 9 } } },
      "2": { uploaded_t: 200, sizes: { "100": { w: 1, h: 1 }, "400": { w: 4, h: 4 }, full: { w: 9, h: 9 } } },
    },
  };

  it("are ignored by default, like the OFF website does", () => {
    const { product, derived } = deriveProductFields(CODE, uploads, OPTIONS);
    assert.equal(product.image_front_url, undefined);
    assert.deepEqual(derived, []);
  });

  it("can fall back to the newest upload, which has no revision in its file name", () => {
    const options = { ...OPTIONS, uploadFallback: "newest" } as const;
    const { product } = deriveProductFields(CODE, uploads, options);

    assert.equal(product.image_front_url, `${BASE}/2.400.jpg`);
    assert.equal(product.image_front_small_url, `${BASE}/2.400.jpg`);
    assert.equal(product.image_front_thumb_url, `${BASE}/2.100.jpg`);

    const image = resolveImages(uploads, options).front!;
    assert.equal(imageUrl(options, CODE, image, "full"), `${BASE}/2.jpg`);
  });
});

describe("languages for text and taxonomy", () => {
  it("fills product_name from another language without touching the per-language fields", () => {
    const { product } = deriveProductFields(CODE, { product_name_fr: "Pâte", product_name_en: "Spread" }, OPTIONS);
    assert.equal(product.product_name, "Spread");
    assert.equal(product.product_name_fr, "Pâte");
  });

  it("does not add product_name when an Italian or generic name exists", () => {
    assert.equal(deriveProductFields(CODE, { product_name_it: "Crema" }, OPTIONS).product.product_name, undefined);
    assert.equal(deriveProductFields(CODE, { product_name: "Cream", product_name_en: "X" }, OPTIONS).product.product_name, "Cream");
  });

  it("fills ingredients_text and categories_tags only when missing", () => {
    const { product } = deriveProductFields(CODE, {
      ingredients_text_fr: "sucre",
      categories_hierarchy: ["en:snacks", "en:sweet-snacks"],
    }, OPTIONS);
    assert.equal(product.ingredients_text, "sucre");
    assert.deepEqual(product.categories_tags, ["en:snacks", "en:sweet-snacks"]);

    const kept = deriveProductFields(CODE, {
      ingredients_text: "zucchero",
      categories_tags: ["en:x"],
      categories_hierarchy: ["en:y"],
    }, OPTIONS).product;
    assert.equal(kept.ingredients_text, "zucchero");
    assert.deepEqual(kept.categories_tags, ["en:x"]);
  });

  it("localizedText prefers the configured language order", () => {
    assert.equal(localizedText({ x_en: "e", x_it: "i" }, "x", ["it", "en"]), "i");
    assert.equal(localizedText({ x_en: "e", x_fr: "f" }, "x", ["it", "en"]), "e");
    assert.equal(localizedText({}, "x", ["it"]), null);
  });
});

describe("robustness", () => {
  it("never throws on malformed image structures and derives nothing from them", () => {
    for (const images of ["oops", 42, null, [], { front_it: "x", front_en: { rev: null }, front_de: { rev: "" } }]) {
      const result = deriveProductFields(CODE, { images, selected_images: images }, OPTIONS);
      assert.deepEqual(result.derived, []);
    }
  });

  it("does not build URLs for an invalid barcode", () => {
    const { derived } = deriveProductFields("not-a-code", { images: { front_it: { rev: "1" } } }, OPTIONS);
    assert.deepEqual(derived, []);
  });
});

describe("required local fields", () => {
  it("reports missing required fields and ignores unknown names", () => {
    assert.equal(isRequiredFieldMissing({}, "name"), true);
    assert.equal(isRequiredFieldMissing({ product_name_it: "Latte" }, "name"), false);
    assert.equal(isRequiredFieldMissing({ image_front_small_url: "https://x/y.jpg" }, "image"), false);
    assert.equal(isRequiredFieldMissing({}, "image"), true);
    assert.equal(isRequiredFieldMissing({ nutriments: {} }, "nutriments"), true);
    assert.equal(isRequiredFieldMissing({}, "typo-field"), false);
  });
});
