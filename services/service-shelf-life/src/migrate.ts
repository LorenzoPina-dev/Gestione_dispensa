import { runMigrations } from "@gestione-dispensa/runtime-db";

await runMigrations({ serviceName: "shelf-life", moduleUrl: import.meta.url });
