/**
 * Audio pre-flight and silence-aware chunking.
 *
 * This is the file that answers the assignment's actual question. Gnani's
 * /stt/v3 accepts 60 seconds of audio; the brief asks for files of 2+ minutes.
 * So the audio has to be cut up, and *where* it is cut is the whole problem:
 * a blind cut every 30 seconds lands mid-word roughly once per cut, and the
 * ASR then hears half a word on each side and produces garbage at every seam.
 *
 * Instead we ask ffmpeg where the speaker paused, and cut there.
 */
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { ffmpeg, ffprobe } from "./ffmpeg";
import { formatMs } from "./format";

// Re-exported because gap markers and error messages built here use it, and
// existing callers import it from this module.
export { formatMs };

/**
 * Chunk sizing. The target is deliberately below the hard cap so that the
 * search for a nearby pause has room to move the boundary *later* without
 * ever crossing the API's limit.
 */
export const TARGET_MS = 25_000;
/** Never exceed this: the API documents 60s, and it prefers 30s or less. */
export const HARD_CAP_MS = 30_000;
/** How far either side of the target we will look for a pause. */
export const SEARCH_WINDOW_MS = 5_000;

/** Pre-flight limits, enforced before a single rupee of API credit is spent. */
export const MAX_DURATION_MS = 10 * 60_000;
export const MAX_BYTES = 40 * 1024 * 1024;

/** silencedetect tuning: quieter than -30dB for at least 300ms counts as a pause. */
const SILENCE_NOISE_DB = -30;
const SILENCE_MIN_DURATION_S = 0.3;

/**
 * A failure we can explain to the user in their own terms, as opposed to an
 * ffmpeg stack trace. `reason` is stable enough to branch on; `message` is
 * written to be shown on screen.
 */
export class AudioError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "undecodable"
      | "no_audio_stream"
      | "too_long"
      | "too_large"
      | "empty",
  ) {
    super(message);
    this.name = "AudioError";
  }
}

export interface Probe {
  durationMs: number;
  codec: string;
  sampleRate: number;
  channels: number;
  sizeBytes: number;
}

/**
 * Step 0 of every job: prove the file is really audio, and really within our
 * limits, before committing to any expensive work.
 *
 * This is what catches invoice.pdf renamed to audio.mp3. ffprobe fails on it
 * in about 200ms, which is far cheaper than discovering the problem across
 * fifteen failed ASR calls.
 */
export async function probe(filePath: string): Promise<Probe> {
  let raw: string;
  try {
    const { stdout } = await ffprobe([
      "-v", "error",
      "-show_entries",
      "format=duration,size:stream=codec_type,codec_name,sample_rate,channels",
      "-of", "json",
      filePath,
    ]);
    raw = stdout;
  } catch {
    // ffprobe exits non-zero on anything it cannot parse as media at all.
    throw new AudioError(
      "This file could not be read as audio. It may be corrupt, or not " +
        "actually an audio file despite its name.",
      "undecodable",
    );
  }

  const parsed = JSON.parse(raw) as {
    format?: { duration?: string; size?: string };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      sample_rate?: string;
      channels?: number;
    }>;
  };

  // A video file with no audio track parses fine and is still useless to us.
  const audio = parsed.streams?.find((s) => s.codec_type === "audio");
  if (!audio) {
    throw new AudioError(
      "This file contains no audio track, so there is nothing to transcribe.",
      "no_audio_stream",
    );
  }

  const durationMs = Math.round(Number(parsed.format?.duration ?? 0) * 1000);
  const sizeBytes = Number(parsed.format?.size ?? 0);

  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new AudioError("This file appears to contain no audio at all.", "empty");
  }
  if (durationMs > MAX_DURATION_MS) {
    throw new AudioError(
      `This recording is ${formatMs(durationMs)} long. The limit is ` +
        `${MAX_DURATION_MS / 60_000} minutes.`,
      "too_long",
    );
  }
  if (sizeBytes > MAX_BYTES) {
    throw new AudioError(
      `This file is ${(sizeBytes / 1024 / 1024).toFixed(1)} MB. The limit is ` +
        `${MAX_BYTES / 1024 / 1024} MB.`,
      "too_large",
    );
  }

  return {
    durationMs,
    codec: audio.codec_name ?? "unknown",
    sampleRate: Number(audio.sample_rate ?? 0),
    channels: audio.channels ?? 0,
    sizeBytes,
  };
}

export interface Silence {
  startMs: number;
  endMs: number;
}

/**
 * Runs ffmpeg's silencedetect filter over the file and returns every pause.
 *
 * `-f null -` means "decode everything, write the result nowhere" -- we only
 * want the filter's commentary, which (like all ffmpeg diagnostics) arrives
 * on stderr in lines that look like:
 *
 *   [silencedetect @ 0x..] silence_start: 24.8
 *   [silencedetect @ 0x..] silence_end: 25.4 | silence_duration: 0.6
 */
export async function detectSilences(filePath: string): Promise<Silence[]> {
  const { stderr } = await ffmpeg([
    "-i", filePath,
    "-af",
    `silencedetect=noise=${SILENCE_NOISE_DB}dB:d=${SILENCE_MIN_DURATION_S}`,
    "-f", "null",
    "-",
  ]);

  const silences: Silence[] = [];
  let openedAt: number | null = null;

  for (const line of stderr.split("\n")) {
    const start = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (start) {
      openedAt = Math.round(Number(start[1]) * 1000);
      continue;
    }
    const end = /silence_end:\s*(-?[\d.]+)/.exec(line);
    if (end && openedAt !== null) {
      silences.push({
        startMs: openedAt,
        endMs: Math.round(Number(end[1]) * 1000),
      });
      openedAt = null;
    }
  }

  // A file that ends mid-silence reports a start with no matching end. There
  // is no boundary decision left to make past the end of the file, so an
  // unclosed pause is simply dropped.
  return silences;
}

export interface ChunkPlan {
  idx: number;
  startMs: number;
  endMs: number;
  /** True when we had to cut at the hard cap because nobody paused. */
  forced: boolean;
}

/**
 * Decides where to cut. A pure function of duration and pause positions,
 * which keeps the interesting logic testable without touching a file.
 *
 * From each boundary we look ahead TARGET_MS, then search a window either side
 * for a pause and cut in the middle of the one nearest the target. If nobody
 * paused anywhere in range -- someone talking without drawing breath -- we cut
 * at HARD_CAP_MS regardless, because the API limit is not negotiable and one
 * damaged word beats a rejected request.
 */
export function planChunks(
  durationMs: number,
  silences: Silence[],
): ChunkPlan[] {
  const plans: ChunkPlan[] = [];
  let cursor = 0;

  while (cursor < durationMs) {
    // Whatever is left already fits in one piece: take it and stop.
    if (durationMs - cursor <= HARD_CAP_MS) {
      plans.push({
        idx: plans.length,
        startMs: cursor,
        endMs: durationMs,
        forced: false,
      });
      break;
    }

    const ideal = cursor + TARGET_MS;
    // `cursor + 1` guarantees forward progress, so the loop always terminates.
    const earliest = Math.max(cursor + 1, ideal - SEARCH_WINDOW_MS);
    const latest = Math.min(cursor + HARD_CAP_MS, ideal + SEARCH_WINDOW_MS);

    // Cutting at the *midpoint* of a pause leaves breathing room on both
    // sides, so neither chunk starts or ends flush against a word.
    let best: number | null = null;
    for (const s of silences) {
      const mid = Math.round((s.startMs + s.endMs) / 2);
      if (mid < earliest || mid > latest) continue;
      if (best === null || Math.abs(mid - ideal) < Math.abs(best - ideal)) {
        best = mid;
      }
    }

    const boundary = best ?? cursor + HARD_CAP_MS;
    plans.push({
      idx: plans.length,
      startMs: cursor,
      endMs: boundary,
      forced: best === null,
    });
    cursor = boundary;
  }

  return plans;
}

/**
 * Cuts one chunk out of the source file.
 *
 * Re-encodes rather than stream-copying, for two reasons: a stream copy can
 * only cut at keyframes, which would silently move our carefully chosen
 * boundaries; and Gnani resamples everything to 16 kHz mono anyway, so doing
 * it here makes each upload a fraction of the size for identical results.
 */
export async function extractChunk(
  src: string,
  dest: string,
  startMs: number,
  endMs: number,
): Promise<void> {
  await ffmpeg([
    "-ss", (startMs / 1000).toFixed(3),
    "-i", src,
    "-t", ((endMs - startMs) / 1000).toFixed(3),
    "-ar", "16000",
    "-ac", "1",
    "-c:a", "pcm_s16le",
    "-y", dest,
  ]);
}

/** A private scratch directory for one job's chunks. */
export function workspace(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "note-"));
}

