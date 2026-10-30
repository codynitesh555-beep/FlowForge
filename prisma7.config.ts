import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import { defineConfig } from "prisma/config";
import { loadPrismaCliEnvironment } from "./src/config/env.js";

const scratchEnvironmentPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  ".env.phase1c-scratch.local",
);

let scratchEnvironment: ReturnType<typeof parse>;
try {
  scratchEnvironment = parse(readFileSync(scratchEnvironmentPath, "utf8"));
} catch {
  throw new Error(
    'Required scratch environment file ".env.phase1c-scratch.local" is missing or unreadable.',
  );
}

// Pass only the explicitly selected scratch file to the guard. Do not merge
// process.env or load the default .env, which could introduce another target.
const prismaEnvironment = loadPrismaCliEnvironment(scratchEnvironment);
process.env.DATABASE_URL = prismaEnvironment.migrationDatabaseUrl;
if (prismaEnvironment.shadowDatabaseUrl) {
  process.env.SHADOW_DATABASE_URL = prismaEnvironment.shadowDatabaseUrl;
} else {
  delete process.env.SHADOW_DATABASE_URL;
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL!,
    ...(process.env.SHADOW_DATABASE_URL
      ? { shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL }
      : {}),
  },
});
