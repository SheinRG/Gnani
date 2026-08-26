/**
 * POST: registers an uploaded blob as a note and starts the pipeline.
 * GET:  the current session's history.
 *
 * The processing model (decision #3): respond immediately with the note id,
 * run the real work in `after()`, and let the client poll. `after()` keeps
 * the function instance alive once the response is flushed -- the platform-
 * blessed way to do background work without a queue, which a take-home does
 * not need and could not justify.
 */
import { after, NextResponse } from "next/server";

import { createNote, listNotes, reapStaleNotes } from "@/lib/db";
import { runPipeline } from "@/lib/pipeline";
import { ensureSession, readSession } from "@/lib/session";
import { isLanguageCode } from "@/lib/gnani";

/**
 * The whole background job must finish inside this window (an `after()`
 * callback shares the route's budget; it does not extend it). 300s previously
 * measured comfortable for the 10-minute worst case; the deploy spike
 * re-verifies on real infrastructure.
 */
export const maxDuration = 300;

/** Jobs quiet for longer than this are dead, not slow (decision #3). */
const STALE_AFTER_MINUTES = 15;

export async function POST(request: Request): Promise<NextResponse> {
  const sessionId = await ensureSession();

  let body: { blobUrl?: string; filename?: string; language?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const { blobUrl, filename, language } = body;
  if (!blobUrl || !filename || !language) {
    return NextResponse.json(
      { error: "blobUrl, filename and language are required." },
      { status: 400 },
    );
  }
  if (!isLanguageCode(language)) {
    return NextResponse.json(
      { error: `Unsupported language: ${language}` },
      { status: 400 },
    );
  }
  // Accept only URLs that point at Vercel Blob storage. Anything else would
  // turn the pipeline into a proxy that downloads arbitrary URLs on demand.
  let host: string;
  try {
    host = new URL(blobUrl).hostname;
  } catch {
    return NextResponse.json({ error: "Invalid blob URL." }, { status: 400 });
  }
  if (!host.endsWith(".blob.vercel-storage.com")) {
    return NextResponse.json({ error: "Invalid blob URL." }, { status: 400 });
  }

  const note = await createNote({ sessionId, blobUrl, filename, language });

  after(() => runPipeline(note));

  return NextResponse.json({ id: note.id }, { status: 201 });
}

export async function GET(): Promise<NextResponse> {
  const sessionId = await readSession();
  if (!sessionId) return NextResponse.json({ notes: [] });

  // Opportunistic reaping: any visit to the history sweeps up jobs that died
  // without writing a final status. The daily cron catches the rest; this
  // catches the common case -- the user staring at a stuck note -- immediately.
  await reapStaleNotes(STALE_AFTER_MINUTES);

  const notes = await listNotes(sessionId);
  return NextResponse.json({
    notes: notes.map((n) => ({
      id: n.id,
      filename: n.filename,
      language: n.language,
      status: n.status,
      durationMs: n.duration_ms,
      title: n.summary?.title ?? null,
      createdAt: n.created_at,
    })),
  });
}
