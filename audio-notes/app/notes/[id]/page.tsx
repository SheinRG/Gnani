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
 * as a marked block with its time range and reason, the transcript carries a
 * visible gap marker at that spot, and `completed_with_errors` offers a
 * retry that re-runs only the failed segments.
 *
 * Styling follows the approved "Organic" design system (see globals.css).
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

const card: React.CSSProperties = {
  background: "var(--color-neutral-100)",
  border: "1px solid var(--color-divider)",
  borderRadius: "var(--radius-lg)",
};

const kicker: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.8px",
  textTransform: "uppercase",
  color: "var(--color-neutral-600)",
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
        <p className="text-lg font-semibold">This note does not exist.</p>
        <p className="mt-1 text-sm" style={{ color: "var(--color-neutral-600)" }}>
          It may belong to a different browser session.
        </p>
        <Link href="/" className="btn btn-primary mt-6 font-bold">
          Back to your notes
        </Link>
      </div>
    );
  }

  if (!note) {
    return (
      <p
        className="py-16 text-center text-sm"
        style={{ color: "var(--color-neutral-600)" }}
      >
        Loading…
      </p>
    );
  }

  const done = note.chunks.filter((c) => c.status === "done").length;
  const failed = note.chunks.filter((c) => c.status === "failed");
  const total = note.chunks.length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-[28px] font-extrabold tracking-[-0.4px]">
            {note.summary?.title ?? note.filename}
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--color-neutral-600)" }}>
            {note.filename}
            {note.durationMs != null && ` · ${formatMs(note.durationMs)}`}
            {note.sizeBytes != null && ` · ${formatBytes(note.sizeBytes)}`}
            {` · ${new Date(note.createdAt).toLocaleString()}`}
          </p>
        </div>
        <StatusBadge status={note.status} />
      </div>

      {note.status === "processing" && (
        <section className="p-6" style={card}>
          <p className="text-sm font-semibold">
            {STAGE_LABEL[note.stage ?? ""] ?? "Working…"}
          </p>

          {note.stage === "transcribing" && total > 0 && (
            <>
              <p
                className="mt-3 text-sm tabular-nums"
                style={{ color: "var(--color-neutral-700)" }}
              >
                {done} of {total} segments transcribed
                {failed.length > 0 && `, ${failed.length} failed`}
              </p>
              <SegmentStrip chunks={note.chunks} />
            </>
          )}
        </section>
      )}

      {note.status === "failed" && (
        <section
          className="p-6"
          style={{
            ...card,
            background: "var(--color-accent-100)",
            border: "1px solid var(--color-accent-300)",
          }}
        >
          <p className="font-semibold" style={{ color: "var(--color-accent-800)" }}>
            This recording could not be processed
          </p>
          <p className="mt-1 text-sm" style={{ color: "var(--color-accent-800)" }}>
            {note.error ?? "Something went wrong."}
          </p>
        </section>
      )}

      {note.status === "completed_with_errors" && (
        <section
          className="p-6"
          style={{
            ...card,
            background: "var(--color-accent-100)",
            border: "1px solid var(--color-accent-300)",
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p
                className="font-semibold"
                style={{ color: "var(--color-accent-800)" }}
              >
                {failed.length} segment{failed.length === 1 ? "" : "s"} could not
                be transcribed
              </p>
              <p className="mt-1 text-sm" style={{ color: "var(--color-accent-700)" }}>
                The transcript below has gaps where those segments belong.
              </p>
            </div>
            <button
              onClick={retry}
              disabled={retrying}
              className="btn btn-primary font-bold"
            >
              {retrying ? "Starting…" : "Retry failed segments"}
            </button>
          </div>
          <ul
            className="mt-3 space-y-1 text-sm"
            style={{ color: "var(--color-accent-800)" }}
          >
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
        <section className="p-6" style={card}>
          <h2 style={kicker}>Summary</h2>
          <p className="mt-2 text-[15px] leading-relaxed">{note.summary.tldr}</p>

          <h3 className="mt-4" style={kicker}>
            Key points
          </h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[15px]">
            {note.summary.keyPoints.map((point, i) => (
              <li key={i}>{point}</li>
            ))}
          </ul>

          {note.summary.actionItems.length > 0 && (
            <>
              <h3 className="mt-4" style={kicker}>
                Action items
              </h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-[15px]">
                {note.summary.actionItems.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {note.transcript && (
        <section className="p-6" style={card}>
          <h2 style={kicker}>Transcript</h2>
          <Transcript text={note.transcript} />
        </section>
      )}
    </div>
  );
}

/** One block per segment: sage done, terracotta failed, sand still queued. */
function SegmentStrip({ chunks }: { chunks: Chunk[] }) {
  return (
    <div className="mt-3 flex gap-1">
      {chunks.map((c) => (
        <div
          key={c.idx}
          title={`${formatMs(c.startMs)}–${formatMs(c.endMs)} · ${c.status}`}
          className="h-2.5 flex-1 rounded-sm transition-colors"
          style={{
            background:
              c.status === "done"
                ? "var(--color-accent-2-500)"
                : c.status === "failed"
                  ? "var(--color-accent-600)"
                  : "var(--color-neutral-300)",
          }}
        />
      ))}
    </div>
  );
}

/** Renders the transcript with gap markers visually distinct from speech. */
function Transcript({ text }: { text: string }) {
  const parts = text.split(/(\[audio unavailable [^\]]+\])/);
  return (
    <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed">
      {parts.map((part, i) =>
        part.startsWith("[audio unavailable") ? (
          <mark
            key={i}
            className="mx-1 rounded-full px-2 py-0.5 text-[13px] font-semibold"
            style={{
              background: "var(--color-accent-200)",
              color: "var(--color-accent-800)",
            }}
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
