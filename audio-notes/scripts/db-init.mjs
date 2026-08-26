/**
 * Applies lib/schema.sql to the database in DATABASE_URL.
 *
 * Run with `npm run db:init`. The schema is idempotent, so this is safe to run
 * repeatedly -- against a fresh Neon branch it creates everything, against an
 * existing one it is a no-op. A full migration tool would be overkill for two
 * tables that will not change shape after submission.
 */
import { neon } from "@neondatabase/serverless";
import { readFile } from "node:fs/promises";
import path from "node:path";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Put it in .env.local and run:");
  console.error("  npm run db:init");
  process.exit(1);
}

const sql = neon(url);
const schema = await readFile(
  path.join(import.meta.dirname, "..", "lib", "schema.sql"),
  "utf8",
);

// The HTTP driver runs one statement per call, so split on the blank-line
// boundaries between statements. Comments are stripped by the server.
const statements = schema
  .split(/;\s*\n/)
  .map((s) => s.trim())
  .filter((s) => s.length > 0 && !s.split("\n").every((l) => l.startsWith("--")));

for (const statement of statements) {
  await sql.query(statement);
}

const [{ count }] = await sql`SELECT count(*)::int AS count FROM notes`;
console.log(`Schema applied. notes table reachable (${count} rows).`);
