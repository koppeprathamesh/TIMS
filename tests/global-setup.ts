import { execSync } from "node:child_process";
import path from "node:path";
import { Pool } from "pg";

// Recreates the isolated PostgreSQL test schema from committed migrations.
export default async function setup() {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  if (!testDatabaseUrl) {
    throw new Error("TEST_DATABASE_URL must point to a dedicated PostgreSQL test database.");
  }

  const testUrl = new URL(testDatabaseUrl);
  const appUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
  if (
    appUrl &&
    testUrl.hostname.toLowerCase() === appUrl.hostname.toLowerCase() &&
    (testUrl.port || "5432") === (appUrl.port || "5432") &&
    decodeURIComponent(testUrl.pathname) === decodeURIComponent(appUrl.pathname)
  ) {
    throw new Error("TEST_DATABASE_URL must not point to the application database.");
  }

  const pool = new Pool({ connectionString: testDatabaseUrl });
  try {
    await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
    await pool.query("CREATE SCHEMA public");
  } finally {
    await pool.end();
  }

  execSync("npx prisma migrate deploy", {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: testDatabaseUrl },
    stdio: "pipe",
  });
}
