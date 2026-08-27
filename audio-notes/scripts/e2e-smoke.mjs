// End-to-end smoke test: uploads a local audio file to Blob, registers it
// as a note against the dev server, and polls until a terminal status.
// Usage: node --env-file=.env.local scripts/e2e-smoke.mjs <audio-file>
import { put } from "@vercel/blob";
import { readFileSync } from "node:fs";

const BASE = "http://localhost:3000";
const wav = process.argv[2];
if (!wav) { console.error("usage: node scripts/e2e-smoke.mjs <audio-file>"); process.exit(1); }

const bytes = readFileSync(wav);
console.log(`uploading ${(bytes.length / 1024 / 1024).toFixed(1)} MB to Blob...`);
const blob = await put("e2e-speech.wav", bytes, {
  access: "private",
  addRandomSuffix: true,
});
console.log("blob:", blob.url);

const create = await fetch(`${BASE}/api/notes`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    blobUrl: blob.url,
    filename: "e2e-speech.wav",
    language: "en-IN",
  }),
});
const cookie = create.headers.get("set-cookie")?.split(";")[0];
const created = await create.json();
if (!create.ok) {
  console.error("create failed:", create.status, created);
  process.exit(1);
}
console.log("note id:", created.id, "| session cookie:", cookie ? "set" : "MISSING");

const started = Date.now();
let last = "";
while (true) {
  await new Promise((r) => setTimeout(r, 3000));
  const res = await fetch(`${BASE}/api/notes/${created.id}`, {
    headers: { cookie },
  });
  if (!res.ok) {
    console.log("poll ->", res.status);
    continue;
  }
  const note = await res.json();
  const done = note.chunks.filter((c) => c.status === "done").length;
  const failed = note.chunks.filter((c) => c.status === "failed").length;
  const line = `${note.status} | stage=${note.stage} | chunks ${done}/${note.chunks.length}${failed ? ` (${failed} failed)` : ""}`;
  if (line !== last) console.log(`[${((Date.now() - started) / 1000).toFixed(0)}s]`, line);
  last = line;

  if (note.status !== "processing") {
    console.log("\n=== FINAL ===");
    console.log("status:", note.status);
    console.log("duration:", note.durationMs, "ms | chunks:", note.chunks.length);
    for (const c of note.chunks) {
      console.log(
        `  #${c.idx} ${c.startMs}-${c.endMs}ms ${c.status}${c.forced ? " (forced cut)" : ""}${c.error ? ` err=${c.error}` : ""}`,
      );
    }
    console.log("\ntranscript:", (note.transcript ?? "(none)").slice(0, 600));
    console.log("\nsummary:", JSON.stringify(note.summary, null, 2)?.slice(0, 800));
    process.exit(note.status.startsWith("completed") ? 0 : 1);
  }
  if (Date.now() - started > 5 * 60_000) {
    console.error("TIMEOUT after 5 minutes");
    process.exit(1);
  }
}
