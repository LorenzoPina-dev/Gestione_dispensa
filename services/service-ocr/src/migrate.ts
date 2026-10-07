import { runMigrations } from "@gestione-dispensa/runtime-db";

await runMigrations({ serviceName: "ocr", moduleUrl: import.meta.url });
