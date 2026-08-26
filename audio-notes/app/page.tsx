"use client";

/**
 * Home: upload a recording, see your history.
 *
 * The upload goes browser -> Blob directly (decision #4). `upload()` asks our
 * /api/upload for a scoped token, streams the file to storage, and reports
 * real transferred-byte progress -- the first half of the brief's "real
 * progress counter". Only then does the server hear about the file at all,
 * via POST /api/notes, which answers instantly with an id and does the actual
 * work in the background while we navigate to the note page.
 */
import { upload } from "@vercel/blob/client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { LANGUAGES, type LanguageCode } from "@/lib/gnani";
import { formatMs, formatBytes } from "@/lib/format";
import { StatusBadge } from "./components/status-badge";

const MAX_BYTES = 40 * 1024 * 1024;

interface HistoryNote {
  id: string;
  filename: string;
  language: string;
  status: string;
  durationMs: number | null;
  title: string | null;
  createdAt: string;
}

type UploadPhase =
  | { kind: "idle" }
  | { kind: "uploading"; percent: number }
  | { kind: "registering" }
  | { kind: "error"; message: string };

export default function HomePage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState<LanguageCode>("en-IN");
  const [phase, setPhase] = useState<UploadPhase>({ kind: "idle" });
  const [history, setHistory] = useState<HistoryNote[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/notes")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setHistory(data.notes ?? []);
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const chooseFile = (picked: File | null) => {
    setPhase({ kind: "idle" });
    if (picked && picked.size > MAX_BYTES) {
      setFile(null);
      setPhase({
        kind: "error",
        message: `That file is ${formatBytes(picked.size)}; the limit is ${formatBytes(MAX_BYTES)}.`,
      });
      return;
    }
    setFile(picked);
  };

  const start = useCallback(async () => {
    if (!file) return;
    setPhase({ kind: "uploading", percent: 0 });

    try {
      const blob = await upload(file.name, file, {
        access: "public",
        handleUploadUrl: "/api/upload",
        onUploadProgress: ({ percentage }) =>
          setPhase({ kind: "uploading", percent: percentage }),
      });

      setPhase({ kind: "registering" });
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blobUrl: blob.url,
          filename: file.name,
          language,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "The server refused this upload.");
      }
      const { id } = await res.json();
      router.push(`/notes/${id}`);
    } catch (err) {
      setPhase({
        kind: "error",
        message:
          err instanceof Error && err.message
            ? err.message
            : "The upload failed. Check your connection and try again.",
      });
    }
  }, [file, language, router]);

  const busy = phase.kind === "uploading" || phase.kind === "registering";

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Turn a recording into notes
          </h1>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            Upload audio up to 10 minutes / 40 MB. You get a transcript and a
            structured summary. Long recordings are split at natural pauses and
            transcribed in parallel.
          </p>
        </div>

        <div className="rounded-xl border border-black/10 p-5 dark:border-white/15">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <label className="flex-1">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-black/50 dark:text-white/50">
                Audio file
              </span>
              <input
                ref={inputRef}
                type="file"
                accept="audio/*,video/mp4,video/webm"
                disabled={busy}
                onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
                className="block w-full cursor-pointer rounded-lg border border-black/10 text-sm file:mr-3 file:cursor-pointer file:rounded-l-lg file:border-0 file:bg-black/5 file:px-4 file:py-2.5 file:text-sm file:font-medium dark:border-white/15 dark:file:bg-white/10"
              />
            </label>

            <label>
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-black/50 dark:text-white/50">
                Spoken language
              </span>
              <select
                value={language}
                disabled={busy}
                onChange={(e) => setLanguage(e.target.value as LanguageCode)}
                className="w-full rounded-lg border border-black/10 bg-transparent px-3 py-2.5 text-sm dark:border-white/15 dark:bg-transparent sm:w-44"
              >
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>

            <button
              onClick={start}
              disabled={!file || busy}
              className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {phase.kind === "uploading"
                ? `Uploading ${Math.round(phase.percent)}%`
                : phase.kind === "registering"
                  ? "Starting…"
                  : "Transcribe"}
            </button>
          </div>

          {phase.kind === "uploading" && (
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
              <div
                className="h-full rounded-full bg-emerald-500 transition-[width] duration-200"
                style={{ width: `${phase.percent}%` }}
              />
            </div>
          )}

          {phase.kind === "error" && (
            <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400">
              {phase.message}
            </p>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-black/50 dark:text-white/50">
          Your notes
        </h2>

        {history === null ? (
          <p className="text-sm text-black/50 dark:text-white/50">Loading…</p>
        ) : history.length === 0 ? (
          <p className="rounded-xl border border-dashed border-black/15 px-4 py-8 text-center text-sm text-black/50 dark:border-white/20 dark:text-white/50">
            Nothing here yet. Your uploads will appear in this list.
          </p>
        ) : (
          <ul className="divide-y divide-black/5 rounded-xl border border-black/10 dark:divide-white/10 dark:border-white/15">
            {history.map((note) => (
              <li key={note.id}>
                <button
                  onClick={() => router.push(`/notes/${note.id}`)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-black/[.03] dark:hover:bg-white/[.04]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {note.title ?? note.filename}
                    </p>
                    <p className="mt-0.5 text-xs text-black/50 dark:text-white/50">
                      {new Date(note.createdAt).toLocaleString()}
                      {note.durationMs != null &&
                        ` · ${formatMs(note.durationMs)}`}
                    </p>
                  </div>
                  <StatusBadge status={note.status} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
