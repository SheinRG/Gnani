/**
 * Database access for notes and chunks.
 *
 * Uses Neon's HTTP driver: each query is a stateless fetch, which is the
 * right shape for serverless -- no connection pool to exhaust, nothing to
 * leak between invocations. The trade-off (no interactive transactions) does
 * not hurt here because every write is a single-row status update.
 *
 * All functions that read on behalf of a user take session_id and scope the
 * query with it. That is the entire authorization model: you can only see
 * notes created by your own cookie.
 */
import { neon } from "@neondatabase/serverless";

import type { ChunkPlan } from "./audio";

function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured.");
  return neon(url);
}

export type NoteStatus =
  | "processing"
  | "completed"
  | "completed_with_errors"
  | "failed";

export type NoteStage =
  | "downloading"
  | "probing"
  | "chunking"
  | "transcribing"
  | "summarizing";

export interface NoteSummary {
  title: string;
  tldr: string;
  keyPoints: string[];
  actionItems: string[];
}

export interface NoteRow {
  id: string;
  session_id: string;
  status: NoteStatus;
  stage: NoteStage | null;
  error: string | null;
  blob_url: string;
  filename: string;
  language: string;
  duration_ms: number | null;
  size_bytes: number | null;
  transcript: string | null;
  summary: NoteSummary | null;
  created_at: string;
  updated_at: string;
}

export interface ChunkRow {
  note_id: string;
  idx: number;
  start_ms: number;
  end_ms: number;
  forced: boolean;
  status: "pending" | "done" | "failed";
  transcript: string | null;
  error: string | null;
  attempts: number;
  request_id: string | null;
}

export async function createNote(fields: {
  sessionId: string;
  blobUrl: string;
  filename: string;
  language: string;
}): Promise<NoteRow> {
  const rows = await sql()`
    INSERT INTO notes (session_id, blob_url, filename, language, stage)
    VALUES (${fields.sessionId}, ${fields.blobUrl}, ${fields.filename},
            ${fields.language}, 'downloading')
    RETURNING *`;
  return rows[0] as NoteRow;
}

export async function getNote(
  id: string,
  sessionId: string,
): Promise<NoteRow | null> {
  const rows = await sql()`
    SELECT * FROM notes WHERE id = ${id} AND session_id = ${sessionId}`;
  return (rows[0] as NoteRow) ?? null;
}

export async function listNotes(sessionId: string): Promise<NoteRow[]> {
  const rows = await sql()`
    SELECT * FROM notes
    WHERE session_id = ${sessionId}
    ORDER BY created_at DESC
    LIMIT 50`;
  return rows as NoteRow[];
}

export async function getChunks(noteId: string): Promise<ChunkRow[]> {
  const rows = await sql()`
    SELECT * FROM chunks WHERE note_id = ${noteId} ORDER BY idx`;
  return rows as ChunkRow[];
}

/** Written once, right after planning, before any ASR call. */
export async function insertChunks(
  noteId: string,
  plans: ChunkPlan[],
): Promise<void> {
  if (plans.length === 0) return;
  // One multi-row INSERT: the HTTP driver has no transactions, so a single
  // statement is what keeps "the plan exists" atomic.
  const s = sql();
  const values = plans
    .map(
      (_, i) =>
        `($1, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4}, $${i * 4 + 5})`,
    )
    .join(", ");
  await s.query(
    `INSERT INTO chunks (note_id, idx, start_ms, end_ms, forced) VALUES ${values}`,
    [noteId, ...plans.flatMap((p) => [p.idx, p.startMs, p.endMs, p.forced])],
  );
}

export async function updateNote(
  id: string,
  fields: Partial<{
    status: NoteStatus;
    stage: NoteStage | null;
    error: string | null;
    duration_ms: number;
    size_bytes: number;
    transcript: string;
    summary: NoteSummary;
  }>,
): Promise<void> {
  const entries = Object.entries(fields);
  if (entries.length === 0) return;
  const sets = entries
    .map(([key], i) => `${key} = $${i + 2}`)
    .join(", ");
  await sql().query(
    `UPDATE notes SET ${sets}, updated_at = now() WHERE id = $1`,
    [
      id,
      ...entries.map(([key, value]) =>
        key === "summary" ? JSON.stringify(value) : value,
      ),
    ],
  );
}

export async function updateChunk(
  noteId: string,
  idx: number,
  fields: Partial<{
    status: ChunkRow["status"];
    transcript: string | null;
    error: string | null;
    attempts: number;
    request_id: string | null;
  }>,
): Promise<void> {
  const entries = Object.entries(fields);
  if (entries.length === 0) return;
  const sets = entries.map(([key], i) => `${key} = $${i + 3}`).join(", ");
  await sql().query(
    `UPDATE chunks SET ${sets}, updated_at = now()
     WHERE note_id = $1 AND idx = $2`,
    [noteId, idx, ...entries.map(([, value]) => value)],
  );
}

/**
 * The reaper's query: jobs that claim to be processing but have not written
 * anything for longer than any legitimate job takes. `updated_at` is the
 * heartbeat -- the pipeline touches its note row at every stage change and
 * every chunk settle, so a genuinely alive job is never this quiet.
 */
export async function reapStaleNotes(olderThanMinutes: number): Promise<number> {
  const rows = await sql()`
    UPDATE notes
    SET status = 'failed',
        stage = NULL,
        error = 'Processing was interrupted and did not resume. Please try again.',
        updated_at = now()
    WHERE status = 'processing'
      AND updated_at < now() - make_interval(mins => ${olderThanMinutes})
    RETURNING id`;
  return rows.length;
}
