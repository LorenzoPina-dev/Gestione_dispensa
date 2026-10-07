import { runMigrations } from "@gestione-dispensa/runtime-db";

await runMigrations({ serviceName: "stores" });
