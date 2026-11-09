import { defineConfig } from "drizzle-kit";

// Used only by `db:generate`: tables live with their feature modules. The migration command
// and the server apply `drizzle/` through `src/infra/db/database.ts`, with validated configuration.
export default defineConfig({
  dialect: "sqlite",
  schema: ["./src/modules/*/*.schema.ts", "./src/infra/db/*.schema.ts"],
  out: "./drizzle",
  strict: true,
  verbose: true,
});
