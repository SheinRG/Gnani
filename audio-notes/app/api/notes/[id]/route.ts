/**
 * The polling endpoint: everything the note page needs to render one note,
 * including per-chunk statuses -- which is what makes the progress counter
 * real ("chunk 7 of 15 transcribed") rather than an animation.
 *
 * Polled every 2 seconds while processing (decision #3). Each poll is one
 * cheap indexed read; no server push machinery to defend in an interview.
 */
import { NextResponse } from "next/server";

import { getChunks, getNote } from "@/lib/db";
import { readSession } from "@/lib/session";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const sessionId = await readSession();
  if (!sessionId) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const { id } = await params;
  // getNote scopes by session -- someone else's note id 404s identically to
  // a nonexistent one, revealing nothing.
  const note = await getNote(id, sessionId);
  if (!note) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const chunks = await getChunks(id);

  return NextResponse.json({
    id: note.id,
    filename: note.filename,
    language: note.language,
    status: note.status,
    stage: note.stage,
    error: note.error,
    durationMs: note.duration_ms,
    sizeBytes: note.size_bytes,
    transcript: note.transcript,
    summary: note.summary,
    createdAt: note.created_at,
    chunks: chunks.map((c) => ({
      idx: c.idx,
      startMs: c.start_ms,
      endMs: c.end_ms,
      forced: c.forced,
      status: c.status,
      error: c.error,
      attempts: c.attempts,
    })),
  });
}
