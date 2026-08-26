"use client";

/**
 * One note, live.
 *
 * While the note is processing this page polls GET /api/notes/[id] every two
 * seconds (decision #3) and renders what the pipeline has actually written to
 * the database: the current stage, then a segment-by-segment progress strip as
 * ASR results land. The counter is "chunks done / chunks total" from real
 * rows -- the brief's "real progress", not a spinner.
 *
 * Failure handling is the other headline requirement: a failed segment shows
 * as a red block with its time range and reason, the transcript carries a
 * visible gap marker at that spot, and `completed_with_errors` offers a
 * retry that re-runs only the failed segments.
 */
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { formatMs, formatBytes } from "@/lib/format";
import { StatusBadge } from "../../components/status-badge";

const POLL_MS = 2_000;

interface Chunk {
  idx: number;
  startMs: number;
  endMs: number;
  forced: boolean;
  status: "pending" | "done" | "failed";
  error: string | null;
  attempts: number;
}

interface Note {
  id: string;
  filename: string;
  language: string;
  status: "processing" | "completed" | "completed_with_errors" | "failed";
  stage: string | null;
  error: string | null;
  durationMs: number | null;
  sizeBytes: number | null;
  transcript: string | null;
  summary: {
    title: string;
    tldr: string;
    keyPoints: string[];
    actionItems: string[];
  } | null;
  createdAt: string;
  chunks: Chunk[];
}

const STAGE_LABEL: Record<string, string> = {
  downloading: "Fetching your file from storage…",
  probing: "Checking the audio…",
  chunking: "Finding natural pauses and splitting…",
  transcribing: "Transcribing segments…",
  summarizing: "Writing the summary…",
};

export default function NotePage() {
  const { id } = useParams<{ id: string }>();
  const [note, setNote] = useState<Note | null>(null);
  const [missing, setMissing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/notes/${id}`);
      if (res.status === 404) {
        setMissing(true);
        return null;
      }
      if (!res.ok) return null;
      const data = (await res.json()) as Note;
      setNote(data);
      return data;
    } catch {
      // Transient fetch failure: keep the last good state, next poll retries.
      return null;
    }
  }, [id]);

  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      const latest = await load();
      if (stopped) return;
      if (!latest || latest.status === "processing") {
        timer.current = setTimeout(tick, POLL_MS);
      }
    };
    tick();
    return () => {
      stopped = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  const retry = async () => {
    setRetrying(true);
    try {
      const res = await fetch(`/api/notes/${id}/retry`, { method: "POST" });
      if (res.ok) {
        // Flip into polling mode; the next tick shows the retry running.
        setNote((n) => n && { ...n, status: "processing", stage: "downloading" });
        timer.current = setTimeout(async function tick() {
          const latest = await load();
          if (!latest || latest.status === "processing") {
            timer.current = setTimeout(tick, POLL_MS);
          }
        }, POLL_MS);
      }
    } finally {
      setRetrying(false);
    }
  };

  if (missing) {
    return (
      <div className="py-16 text-center">
        <p className="text-lg font-medium">This note does not exist.</p>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          It may belong to a different browser session.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-700"
        >
          Back to your notes
        </Link>
      </div>
    );
  }

  if (!note) {
    return (
      <p className="py-16 text-center text-sm text-black/50 dark:text-white/50">
        Loading…
      </p>
    );
  }

  const done = note.chunks.filter((c) => c.status === "done").length;
  const failed = note.chunks.filter((c) => c.status === "failed");
  const total = note.chunks.length;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">
            {note.summary?.title ?? note.filename}
          </h1>
          <p className="mt-1 text-sm text-black/50 dark:text-white/50">
            {note.filename}
            {note.durationMs != null && ` · ${formatMs(note.durationMs)}`}
            {note.sizeBytes != null && ` · ${formatBytes(note.sizeBytes)}`}
            {` · ${new Date(note.createdAt).toLocaleString()}`}
          </p>
        </div>
        <StatusBadge status={note.status} />
      </div>

      {note.status === "processing" && (
        <section className="rounded-xl border border-black/10 p-5 dark:border-white/15">
          <p className="text-sm font-medium">
            {STAGE_LABEL[note.stage ?? ""] ?? "Working…"}
          </p>

          {note.stage === "transcribing" && total > 0 && (
            <>
              <p className="mt-3 text-sm text-black/60 dark:text-white/60">
                {done} of {total} segments transcribed
                {failed.length > 0 && `, ${failed.length} failed`}
              </p>
              <SegmentStrip chunks={note.chunks} />
            </>
          )}
        </section>
      )}

      {note.status === "failed" && (
        <section className="rounded-xl border border-red-500/30 bg-red-500/5 p-5">
          <p className="font-medium text-red-700 dark:text-red-400">
            This recording could not be processed
          </p>
          <p className="mt-1 text-sm text-red-700/80 dark:text-red-400/80">
            {note.error ?? "Something went wrong."}
          </p>
        </section>
      )}

      {note.status === "completed_with_errors" && (
        <section className="rounded-xl border border-orange-500/30 bg-orange-500/5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium text-orange-700 dark:text-orange-400">
                {failed.length} segment{failed.length === 1 ? "" : "s"} could
                not be transcribed
              </p>
              <p className="mt-1 text-sm text-orange-700/80 dark:text-orange-400/80">
                The transcript below has gaps where those segments belong.
              </p>
            </div>
            <button
              onClick={retry}
              disabled={retrying}
              className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
            >
              {retrying ? "Starting…" : "Retry failed segments"}
            </button>
          </div>
          <ul className="mt-3 space-y-1 text-sm text-orange-700/90 dark:text-orange-400/90">
            {failed.map((c) => (
              <li key={c.idx}>
                {formatMs(c.startMs)}–{formatMs(c.endMs)}: {c.error ?? "failed"}
                {c.attempts > 1 && ` (after ${c.attempts} attempts)`}
              </li>
            ))}
          </ul>
        </section>
      )}

      {note.summary && (
        <section className="rounded-xl border border-black/10 p-5 dark:border-white/15">
          <h2 className="text-xs font-medium uppercase tracking-wide text-black/50 dark:text-white/50">
            Summary
          </h2>
          <p className="mt-2 text-sm leading-relaxed">{note.summary.tldr}</p>

          <h3 className="mt-4 text-xs font-medium uppercase tracking-wide text-black/50 dark:text-white/50">
            Key points
          </h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {note.summary.keyPoints.map((point, i) => (
              <li key={i}>{point}</li>
            ))}
          </ul>

          {note.summary.actionItems.length > 0 && (
            <>
              <h3 className="mt-4 text-xs font-medium uppercase tracking-wide text-black/50 dark:text-white/50">
                Action items
              </h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                {note.summary.actionItems.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {note.transcript && (
        <section className="rounded-xl border border-black/10 p-5 dark:border-white/15">
          <h2 className="text-xs font-medium uppercase tracking-wide text-black/50 dark:text-white/50">
            Transcript
          </h2>
          <Transcript text={note.transcript} />
        </section>
      )}
    </div>
  );
}

/** One block per segment: green done, red failed, grey still queued. */
function SegmentStrip({ chunks }: { chunks: Chunk[] }) {
  return (
    <div className="mt-3 flex gap-1">
      {chunks.map((c) => (
        <div
          key={c.idx}
          title={`${formatMs(c.startMs)}–${formatMs(c.endMs)} · ${c.status}`}
          className={`h-2.5 flex-1 rounded-sm transition-colors ${
            c.status === "done"
              ? "bg-emerald-500"
              : c.status === "failed"
                ? "bg-red-500"
                : "bg-black/15 dark:bg-white/15"
          }`}
        />
      ))}
    </div>
  );
}

/** Renders the transcript with gap markers visually distinct from speech. */
function Transcript({ text }: { text: string }) {
  const parts = text.split(/(\[audio unavailable [^\]]+\])/);
  return (
    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
      {parts.map((part, i) =>
        part.startsWith("[audio unavailable") ? (
          <mark
            key={i}
            className="mx-1 rounded bg-red-500/15 px-1.5 py-0.5 font-medium text-red-700 dark:text-red-400"
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </p>
  );
}
