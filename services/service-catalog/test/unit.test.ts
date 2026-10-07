      quantityValue: 90,
      quantityUnit: "g",
      quantityLabel: "90 g",
      images: { front: "https://images.openfoodfacts.org/images/products/800/344/012/0156/front_fr.3.400.jpg" },
      version: 2,
    });
    let externalCalls = 0;
    let refreshCalls = 0;

    const lookup: CatalogLookupRepository = {
      findByIdentifier: async () => stale,
      persistExternalMatch: async () => refreshed,
      refreshExternalMatch: async () => {
        refreshCalls += 1;
        return refreshed;
      },
    };
    const external: ExternalBarcodeLookupClient = {
      lookup: async () => {
        externalCalls += 1;
        return {
          canonicalName: "Golia",
          brand: "Golia",
          defaultUnit: "g",
          category: "confectionery-candy",
          calories: 240,
          protein: 0,
          carbs: 45.2,
          fat: 0.2,
          images: { front: "https://images.openfoodfacts.org/images/products/800/344/012/0156/front_fr.3.400.jpg" },
          quantityValue: 90,
          quantityUnit: "g",
          quantityLabel: "90 g",
          openFoodFacts: {
            code: "8003440120156",
            quantity: "90 g",
            product_quantity: 90,
            product_quantity_unit: "g",
          },
          source: "openfoodfacts",
          sourceVersion: "off-canonical-v1-cache",
          sourceRef: "8003440120156",
          confidence: 0.85,
        };