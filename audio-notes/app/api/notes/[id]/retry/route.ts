/**
 * "Retry failed segments" (decision #6): re-runs only the chunks that failed,
 * leaving successful transcriptions untouched and unbilled.
 *
 * Guarded to `completed_with_errors` -- retrying a completed note is a no-op
 * request, and retrying one still processing would race the running job.
 */
import { after, NextResponse } from "next/server";

import { getNote, updateNote } from "@/lib/db";
import { retryFailedChunks } from "@/lib/pipeline";
import { readSession } from "@/lib/session";

/** Same budget reasoning as the main pipeline route. */
export const maxDuration = 300;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const sessionId = await readSession();
  if (!sessionId) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const { id } = await params;
  const note = await getNote(id, sessionId);
  if (!note) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (note.status !== "completed_with_errors") {
    return NextResponse.json(
      { error: "Only notes with failed segments can be retried." },
      { status: 409 },
    );
  }

  // Flip back to processing before responding so the very next poll shows
  // the retry in flight.
  await updateNote(note.id, { status: "processing", stage: "downloading", error: null });

  after(() => retryFailedChunks(note));

  return NextResponse.json({ ok: true });
}
