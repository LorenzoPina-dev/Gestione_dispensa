import { runMigrations } from "@gestione-dispensa/runtime-db";

await runMigrations({ serviceName: "food-semantics" });
