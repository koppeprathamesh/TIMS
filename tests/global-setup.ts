import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";

// Builds a fresh SQLite test database from the committed migrations.
export default function setup() {
  const prismaDir = path.resolve(__dirname, "..", "prisma");
  for (const file of ["test.db", "test.db-journal"]) {
    const p = path.join(prismaDir, file);
    if (existsSync(p)) rmSync(p);
  }
  execSync("npx prisma migrate deploy", {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
    stdio: "pipe",
  });
}
