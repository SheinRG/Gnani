/**
 * The background job: blob in, transcript + summary out.
 *
 * Runs inside `after()`, so the response to the user has already gone out --
 * nobody is waiting on this except the poller. Every stage change and every
 * chunk settle writes to Postgres, which serves two masters at once: the
 * progress UI polling every 2 seconds, and the cron reaper using
 * `notes.updated_at` as a liveness heartbeat.
 *
 * Failure philosophy (decision #6): one bad chunk must not sink the note.
 * A chunk that exhausts its retries becomes a timestamped gap marker in the
 * transcript and the note completes `completed_with_errors`, from which the
 * user can retry just the failed segments. Only failures that poison
 * everything -- unreadable file, dead API key -- fail the whole note.
 */
import { readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";

import {
  probe,
  detectSilences,
  planChunks,
  extractChunk,
  workspace,
  formatMs,
  AudioError,
  type ChunkPlan,
} from "./audio";
import { transcribeChunk, GnaniError, type LanguageCode } from "./gnani";
import { pool } from "./pool";
import {
  getChunks,
  insertChunks,
  updateChunk,
  updateNote,
  type ChunkRow,
  type NoteRow,
} from "./db";
import { summarize } from "./summary";

/** Decision #7: at most this many ASR requests in flight per job. */
const CONCURRENCY = 4;

export async function runPipeline(note: NoteRow): Promise<void> {
  const dir = await workspace();
  try {
    // -- Download ---------------------------------------------------------
    // The blob was uploaded straight from the browser; this is the first
    // time the server touches the actual bytes.
    const src = path.join(dir, "source");
    await download(note.blob_url, src);

    // -- Pre-flight -------------------------------------------------------
    await updateNote(note.id, { stage: "probing" });
    const info = await probe(src);
    await updateNote(note.id, {
      duration_ms: info.durationMs,
      size_bytes: info.sizeBytes,
    });

    // -- Plan and cut -----------------------------------------------------
    await updateNote(note.id, { stage: "chunking" });
    const silences = await detectSilences(src);
    const plans = planChunks(info.durationMs, silences);
    await insertChunks(note.id, plans);

    const files = new Map<number, string>();
    for (const plan of plans) {
      const dest = path.join(dir, `chunk-${plan.idx}.wav`);
      await extractChunk(src, dest, plan.startMs, plan.endMs);
      files.set(plan.idx, dest);
    }

    // -- Fan out ----------------------------------------------------------
    await updateNote(note.id, { stage: "transcribing" });
    const failure = await transcribePlans(note, plans, files);

    // A poisoned-key failure aborts with a clear message instead of writing
    // twenty identical gap markers.
    if (failure) {
      await updateNote(note.id, {
        status: "failed",
        stage: null,
        error: failure,
      });
      return;
    }

    await finalize(note);
  } catch (err) {
    await updateNote(note.id, {
      status: "failed",
      stage: null,
      error:
        err instanceof AudioError
          ? err.message
          : "Something went wrong while processing this recording.",
    });
    if (!(err instanceof AudioError)) console.error("pipeline failed:", err);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Decision #6's retry button: re-run only the chunks that failed, using the
 * boundaries already stored in the database. The source is downloaded and
 * re-cut -- chunk files do not outlive their job's temp directory -- but
 * chunks that already succeeded are never re-transcribed and never re-billed.
 */
export async function retryFailedChunks(note: NoteRow): Promise<void> {
  const dir = await workspace();
  try {
    const failed = (await getChunks(note.id)).filter(
      (c) => c.status === "failed",
    );
    if (failed.length === 0) return;

    const src = path.join(dir, "source");
    await download(note.blob_url, src);

    await updateNote(note.id, { stage: "transcribing" });
    const plans: ChunkPlan[] = failed.map((c) => ({
      idx: c.idx,
      startMs: c.start_ms,
      endMs: c.end_ms,
      forced: c.forced,
    }));

    const files = new Map<number, string>();
    for (const plan of plans) {
      const dest = path.join(dir, `chunk-${plan.idx}.wav`);
      await extractChunk(src, dest, plan.startMs, plan.endMs);
      files.set(plan.idx, dest);
      // Back to pending so the UI shows these segments as in-flight again.
      await updateChunk(note.id, plan.idx, { status: "pending", error: null });
    }

    const failure = await transcribePlans(note, plans, files);
    if (failure) {
      await updateNote(note.id, { status: "failed", stage: null, error: failure });
      return;
    }

    await finalize(note);
  } catch (err) {
    console.error("retry failed:", err);
    await updateNote(note.id, {
      status: "completed_with_errors",
      stage: null,
      error: "Retrying the failed segments did not succeed. Try again later.",
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Runs the ASR fan-out and records every outcome. Returns a message only for
 * failures that make continuing pointless (bad API key); otherwise null, and
 * per-chunk verdicts live in the chunks table.
 */
async function transcribePlans(
  note: NoteRow,
  plans: ChunkPlan[],
  files: Map<number, string>,
): Promise<string | null> {
  let fatal: string | null = null;

  await pool(
    plans,
    CONCURRENCY,
    async (plan) => {
      const audio = await readFile(files.get(plan.idx)!);
      return transcribeChunk(new Uint8Array(audio), `chunk-${plan.idx}.wav`, {
        language: note.language as LanguageCode,
      });
    },
    async (settled, plan) => {
      if (settled.status === "fulfilled") {
        await updateChunk(note.id, plan.idx, {
          status: "done",
          transcript: settled.value.transcript,
          error: null,
          attempts: settled.value.attempts,
          request_id: settled.value.requestId,
        });
      } else {
        const reason = settled.reason;
        const message =
          reason instanceof GnaniError
            ? reason.message
            : "This segment failed unexpectedly.";
        if (reason instanceof GnaniError && (reason.status === 401 || reason.status === 403)) {
          fatal = "The transcription service rejected our API key. This is a configuration problem, not a problem with your audio.";
        }
        await updateChunk(note.id, plan.idx, {
          status: "failed",
          error: message,
          attempts: reason instanceof GnaniError ? reason.attempts : 1,
        });
      }
      // Heartbeat: proves to the reaper this job is still alive.
      await updateNote(note.id, { stage: "transcribing" });
    },
  );

  return fatal;
}

/**
 * Assembles the final transcript from chunk rows, summarizes it, and settles
 * the note's final status. Shared by the first run and every retry.
 */
async function finalize(note: NoteRow): Promise<void> {
  const chunks = await getChunks(note.id);
  const failedCount = chunks.filter((c) => c.status === "failed").length;

  if (failedCount === chunks.length) {
    await updateNote(note.id, {
      status: "failed",
      stage: null,
      error:
        "No part of this recording could be transcribed. The transcription " +
        "service may be down; retrying later may help.",
    });
    return;
  }

  const transcript = chunks
    .map((c) =>
      c.status === "done"
        ? (c.transcript ?? "")
        : gapMarker(c),
    )
    .filter((part) => part.length > 0)
    .join(" ");

  await updateNote(note.id, { stage: "summarizing", transcript });
  const summary = await summarize(transcript, note.language);
  if (summary) await updateNote(note.id, { summary });

  await updateNote(note.id, {
    status: failedCount > 0 ? "completed_with_errors" : "completed",
    stage: null,
    error: null,
  });
}

function gapMarker(chunk: ChunkRow): string {
  return `[audio unavailable ${formatMs(chunk.start_ms)}-${formatMs(chunk.end_ms)}]`;
}

async function download(url: string, dest: string): Promise<void> {
  // The store is private: a plain fetch of the URL would 403. The SDK signs
  // the read with this deployment's BLOB_READ_WRITE_TOKEN.
  const { get } = await import("@vercel/blob");
  const result = await get(url, { access: "private" });
  if (!result) {
    throw new AudioError(
      "The uploaded file could not be retrieved from storage.",
      "undecodable",
    );
  }
  const bytes = await new Response(result.stream).arrayBuffer();
  await writeFile(dest, new Uint8Array(bytes));
}
