"use client";

/**
 * Home: upload a recording, see your history. Visual design implemented from
 * the approved Claude Design file (Gnani Audio Notes.dc.html) on the
 * "Organic" system; the data flow is the real one:
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
import { Aurora } from "./components/aurora";
import { STATUS_STYLE } from "./components/status-badge";

const MAX_BYTES = 40 * 1024 * 1024;

const LANG_LABEL = Object.fromEntries(
  LANGUAGES.map((l) => [l.code, l.label]),
) as Record<string, string>;

interface HistoryNote {
  id: string;
  filename: string;
  language: string;
  status: string;
  durationMs: number | null;
  title: string | null;
  createdAt: string;
}

type Phase =
  | { kind: "idle" }
  | { kind: "uploading"; percent: number }
  | { kind: "registering" };

export default function HomePage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState<LanguageCode>("en-IN");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
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

  const take = (picked: File | null | undefined) => {
    if (!picked) return;
    if (picked.size > MAX_BYTES) {
      setFile(null);
      setError(
        `That file is ${formatBytes(picked.size)} — the limit is 40 MB. Try trimming it first.`,
      );
      return;
    }
    setFile(picked);
    setError("");
    setPhase({ kind: "idle" });
  };

  const start = useCallback(async () => {
    if (!file || phase.kind !== "idle") return;
    setError("");
    setPhase({ kind: "uploading", percent: 0 });

    try {
      const blob = await upload(file.name, file, {
        access: "private",
        handleUploadUrl: "/api/upload",
        onUploadProgress: ({ percentage }) =>
          setPhase({ kind: "uploading", percent: percentage }),
      });

      setPhase({ kind: "registering" });
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blobUrl: blob.url, filename: file.name, language }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "The server refused this upload.");
      }
      const { id } = await res.json();
      router.push(`/notes/${id}`);
    } catch (err) {
      setPhase({ kind: "idle" });
      setError(
        err instanceof Error && err.message
          ? err.message
          : "The upload failed. Check your connection and try again.",
      );
    }
  }, [file, language, phase.kind, router]);

  const uploading = phase.kind !== "idle";
  const percent = phase.kind === "uploading" ? phase.percent : 100;
  const loading = history === null;

  return (
    <div className="relative">
      <Aurora />
      <div className="flex flex-col gap-11">
        {/* — hero — */}
        <section className="flex flex-wrap items-end justify-between gap-6 pb-2.5 pt-6">
          <div className="max-w-[560px]">
            <div
              className="inline-flex items-center gap-2 rounded-full py-[5px] pl-2 pr-3 text-[12.5px] font-semibold tracking-[0.3px]"
              style={{
                background: "var(--color-accent-2-200)",
                color: "var(--color-accent-2-800)",
              }}
            >
              <span
                className="h-[7px] w-[7px] rounded-full"
                style={{
                  background: "var(--color-accent-2-600)",
                  animation: "gn-pulse 2s ease-in-out infinite",
                }}
              />
              Speech-to-text, 10 Indian languages
            </div>
            <h1
              className="mt-[18px] font-extrabold leading-[1.06] tracking-[-0.4px]"
              style={{ fontSize: "clamp(34px, 5.4vw, 52px)", textWrap: "pretty" }}
            >
              Talk it through.
              <br />
              Get the notes back.
            </h1>
            <p
              className="mt-4 max-w-[40ch] text-[16.5px] leading-[1.6]"
              style={{ color: "var(--color-neutral-800)", textWrap: "pretty" }}
            >
              Upload a recording. Get a clean transcript and a short summary
              back in about a minute.
            </p>
          </div>
          <div className="flex gap-[26px] py-1">
            <div>
              <div className="text-[28px] font-extrabold leading-none tracking-[-0.5px]">
                40<span className="text-[17px]">MB</span>
              </div>
              <div
                className="mt-1.5 text-[12.5px] tracking-[0.3px]"
                style={{ color: "var(--color-neutral-600)" }}
              >
                per file
              </div>
            </div>
            <div>
              <div className="text-[28px] font-extrabold leading-none tracking-[-0.5px]">
                ~90<span className="text-[17px]">s</span>
              </div>
              <div
                className="mt-1.5 text-[12.5px] tracking-[0.3px]"
                style={{ color: "var(--color-neutral-600)" }}
              >
                typical turnaround
              </div>
            </div>
          </div>
        </section>

        {/* — upload card — */}
        <section
          className="flex flex-col gap-5 p-[26px]"
          style={{
            background: "var(--color-neutral-100)",
            border: "1px solid var(--color-divider)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-md)",
          }}
        >
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              if (!dragging) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              take(e.dataTransfer?.files?.[0]);
            }}
            className="relative cursor-pointer px-6 py-[34px] text-center transition-[border-color,background,transform] duration-[180ms]"
            style={{
              border: `2px dashed ${dragging ? "var(--color-accent-400)" : "var(--color-neutral-400)"}`,
              borderRadius: "var(--radius-md)",
              background: dragging ? "var(--color-accent-100)" : undefined,
            }}
          >
            {dragging && (
              <div
                className="pointer-events-none absolute inset-0 rounded-[14px] opacity-70"
                style={{ background: "var(--color-accent-200)" }}
              />
            )}
            <div className="relative flex flex-col items-center gap-3.5">
              <div
                className="grid h-[62px] w-[62px] place-items-center rounded-full"
                style={{
                  background: "var(--color-accent-200)",
                  color: "var(--color-accent-800)",
                }}
              >
                <svg
                  width="26"
                  height="26"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 3v12" />
                  <path d="m7 8 5-5 5 5" />
                  <path d="M4 15v3a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-3" />
                </svg>
              </div>
              <div>
                <div className="text-[17px] font-semibold">
                  Drop a recording here
                </div>
                <div
                  className="mt-[5px] text-sm"
                  style={{ color: "var(--color-neutral-600)" }}
                >
                  or click to pick a file — mp3, m4a, wav, webm
                </div>
              </div>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept="audio/*,video/mp4,video/webm"
              disabled={uploading}
              onChange={(e) => take(e.target.files?.[0])}
              onClick={(e) => e.stopPropagation()}
              className="hidden"
            />
          </div>

          {file && (
            <div
              className="flex flex-wrap items-center gap-3 px-4 py-[13px]"
              style={{
                borderRadius: "var(--radius-md)",
                background: "var(--color-accent-2-100)",
                border: "1px solid var(--color-accent-2-300)",
                animation: "gn-rise .55s cubic-bezier(.22,1,.36,1) both",
              }}
            >
              <span
                className="grid h-9 w-9 flex-none place-items-center rounded-full"
                style={{
                  background: "var(--color-accent-2-300)",
                  color: "var(--color-accent-2-800)",
                }}
              >
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9 18V5l12-2v13" />
                  <circle cx="6" cy="18" r="3" />
                  <circle cx="18" cy="16" r="3" />
                </svg>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14.5px] font-semibold">
                  {file.name}
                </span>
                <span
                  className="mt-0.5 block text-[12.5px]"
                  style={{ color: "var(--color-accent-2-800)" }}
                >
                  {formatBytes(file.size)}
                  {"  ·  "}
                  {file.type || "audio"}
                </span>
              </span>
              <button
                onClick={() => {
                  if (inputRef.current) inputRef.current.value = "";
                  setFile(null);
                  setError("");
                  setPhase({ kind: "idle" });
                }}
                disabled={uploading}
                className="cursor-pointer rounded-full border-0 bg-transparent px-3 py-[7px] text-[13.5px] font-semibold transition-colors hover:bg-[var(--color-neutral-200)] disabled:cursor-not-allowed disabled:opacity-50"
                style={{ color: "var(--color-neutral-700)" }}
              >
                Remove
              </button>
            </div>
          )}

          {error && (
            <div
              className="flex items-center gap-2.5 px-4 py-3 text-sm"
              style={{
                borderRadius: "var(--radius-md)",
                background: "var(--color-accent-100)",
                border: "1px solid var(--color-accent-300)",
                color: "var(--color-accent-800)",
                animation: "gn-rise .55s cubic-bezier(.22,1,.36,1) both",
              }}
            >
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="flex-none"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v4" />
                <path d="M12 16h.01" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          <div className="flex flex-wrap items-end gap-3.5">
            <label className="min-w-[210px] flex-1">
              <span
                className="mb-[7px] block text-xs font-bold uppercase tracking-[0.8px]"
                style={{ color: "var(--color-neutral-600)" }}
              >
                Spoken language
              </span>
              <select
                className="input w-full cursor-pointer"
                value={language}
                disabled={uploading}
                onChange={(e) => setLanguage(e.target.value as LanguageCode)}
              >
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="btn btn-primary inline-flex items-center gap-[9px] font-bold"
              style={{ minHeight: 46, paddingInline: 26 }}
              onClick={start}
              disabled={!file || uploading}
            >
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m5 3 14 9-14 9V3Z" />
              </svg>
              {phase.kind === "uploading"
                ? `Uploading ${Math.round(percent)}%`
                : phase.kind === "registering"
                  ? "Starting…"
                  : "Transcribe"}
            </button>
          </div>

          {uploading && (
            <div
              className="flex flex-col gap-[9px]"
              style={{ animation: "gn-rise .55s cubic-bezier(.22,1,.36,1) both" }}
            >
              <div
                className="h-[9px] overflow-hidden rounded-full"
                style={{ background: "var(--color-neutral-200)" }}
              >
                <div
                  className="h-full rounded-full transition-[width] duration-[180ms] ease-linear"
                  style={{
                    background: "var(--color-accent)",
                    width: `${Math.round(percent)}%`,
                  }}
                />
              </div>
              <div
                className="flex justify-between text-[12.5px] tabular-nums"
                style={{ color: "var(--color-neutral-700)" }}
              >
                <span>
                  {phase.kind === "registering"
                    ? "Handing it to the transcriber…"
                    : "Sending to secure storage"}
                </span>
                <span>
                  {file &&
                    `${formatBytes(Math.round((file.size * percent) / 100))} of ${formatBytes(file.size)}`}
                </span>
              </div>
            </div>
          )}
        </section>

        {/* — history — */}
        <section className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="m-0 text-[26px] font-extrabold">Your notes</h2>
            <span
              className="whitespace-nowrap text-[13px]"
              style={{ color: "var(--color-neutral-600)" }}
            >
              {loading
                ? "Loading your notes…"
                : `${history.length} ${history.length === 1 ? "recording" : "recordings"}`}
            </span>
          </div>

          {loading ? (
            <div className="flex flex-col gap-2.5">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 px-5 py-[18px]"
                  style={{
                    borderRadius: "var(--radius-md)",
                    background: "var(--color-neutral-100)",
                    border: "1px solid var(--color-divider)",
                  }}
                >
                  <div className="h-[42px] w-[42px] flex-none rounded-full gn-shimmer" />
                  <div className="flex flex-1 flex-col gap-[9px]">
                    <div className="h-[13px] w-[52%] rounded-full gn-shimmer" />
                    <div className="h-[10px] w-[30%] rounded-full gn-shimmer" />
                  </div>
                </div>
              ))}
            </div>
          ) : history.length === 0 ? (
            <div
              className="px-6 py-[54px] text-center"
              style={{
                border: "2px dashed var(--color-neutral-300)",
                borderRadius: "var(--radius-lg)",
                background:
                  "color-mix(in srgb, var(--color-neutral-100) 60%, transparent)",
              }}
            >
              <div
                className="mx-auto grid h-[54px] w-[54px] place-items-center rounded-full"
                style={{
                  background: "var(--color-neutral-200)",
                  color: "var(--color-neutral-600)",
                }}
              >
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 6h16" />
                  <path d="M4 12h11" />
                  <path d="M4 18h7" />
                </svg>
              </div>
              <p className="mb-0 mt-4 text-[15.5px] font-semibold">
                Nothing here yet
              </p>
              <p
                className="mb-0 mt-[5px] text-sm"
                style={{ color: "var(--color-neutral-600)" }}
              >
                Your first upload will show up in this list.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {history.map((note) => {
                const st = STATUS_STYLE[note.status] ?? STATUS_STYLE.processing;
                return (
                  <button
                    key={note.id}
                    onClick={() => router.push(`/notes/${note.id}`)}
                    className="flex cursor-pointer items-center gap-4 px-5 py-[17px] text-left transition-[transform,box-shadow,border-color] duration-[160ms] hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)] hover:!border-[var(--color-accent-300)]"
                    style={{
                      borderRadius: "var(--radius-md)",
                      background: "var(--color-neutral-100)",
                      border: "1px solid var(--color-divider)",
                      animation: "gn-rise .6s cubic-bezier(.22,1,.36,1) both",
                    }}
                  >
                    <span
                      className="grid h-[42px] w-[42px] flex-none place-items-center rounded-full"
                      style={{ background: st.dotBg, color: st.dotFg }}
                    >
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M3 12h3l2-5 3 11 3-8 2 4h5" />
                      </svg>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15.5px] font-semibold">
                        {note.title ?? note.filename}
                      </span>
                      <span
                        className="mt-1 block truncate text-[12.5px]"
                        style={{ color: "var(--color-neutral-600)" }}
                      >
                        {[
                          new Date(note.createdAt).toLocaleString(),
                          note.durationMs != null ? formatMs(note.durationMs) : null,
                          LANG_LABEL[note.language],
                        ]
                          .filter(Boolean)
                          .join("  ·  ")}
                      </span>
                    </span>
                    <span className={`tag ${st.tagClass} flex-none`}>
                      {st.label}
                    </span>
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="var(--color-neutral-500)"
                      strokeWidth="2.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="flex-none"
                    >
                      <path d="m9 6 6 6-6 6" />
                    </svg>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
