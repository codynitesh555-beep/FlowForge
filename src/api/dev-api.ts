import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";
import { loadPrismaCliEnvironment } from "../config/env.js";

// The local API runner uses the approved scratch environment explicitly.
// It does not inherit DATABASE_URL or PG* routing values from the shell.
const scratchEnvironmentPath = resolve(process.cwd(), ".env.phase1c-scratch.local");
const scratchEnvironment = parse(readFileSync(scratchEnvironmentPath, "utf8"));
const validatedEnvironment = loadPrismaCliEnvironment(scratchEnvironment);

for (const key of Object.keys(process.env)) {
  if (["DATABASE_URL", "MIGRATION_DATABASE_URL", "SHADOW_DATABASE_URL", "TEST_DATABASE_URL"].includes(key) || key.startsWith("PG")) {
    delete process.env[key];
  }
}
Object.assign(process.env, scratchEnvironment);
process.env.DATABASE_URL = validatedEnvironment.migrationDatabaseUrl;
if (validatedEnvironment.shadowDatabaseUrl) {
  process.env.SHADOW_DATABASE_URL = validatedEnvironment.shadowDatabaseUrl;
} else {
  delete process.env.SHADOW_DATABASE_URL;
}

// Development access tokens use a per-process key. Production startup still
// requires an explicitly configured secret through the normal runtime path.
process.env.NODE_ENV = "development";
process.env.ACCESS_TOKEN_SECRET = randomBytes(48).toString("base64url");
process.env.API_HOST ??= "127.0.0.1";
process.env.API_PORT ??= "3000";
process.env.DOTENV_CONFIG_PATH = scratchEnvironmentPath;

try {
  const { startApi } = await import("./main.js");
  await startApi();
} catch {
  process.stderr.write("FlowForge API startup failed. Check scratch database connectivity and local API configuration.\n");
  process.exitCode = 1;
}
