import { defineConfig } from "vitest/config";
import path from "node:path";
import "dotenv/config";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("Set TEST_DATABASE_URL to a dedicated PostgreSQL test database before running tests.");
}

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    env: {
      DATABASE_URL: testDatabaseUrl,
      JWT_SECRET: "test-secret-test-secret-test-secret-123456",
    },
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 60000,
  },
});
