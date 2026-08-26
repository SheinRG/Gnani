/**
 * Client for Gnani's speech-to-text endpoint.
 *
 * The whole design of this file follows from one line in their docs: the
 * endpoint is synchronous and takes at most 60 seconds of audio. So callers
 * hand it one already-cut chunk, and the interesting behaviour here is not the
 * request itself but what happens when the request fails.
 *
 * The key judgement is transient vs permanent. A 429 or a 503 means "try me
 * again shortly" and retrying is correct. A 400 means the audio is malformed
 * and will be exactly as malformed on the fourth attempt -- retrying spends
 * three more calls to learn nothing. Getting that distinction right is most of
 * what separates a client that degrades well from one that burns credits.
 */

const ENDPOINT = "https://api.vachana.ai/stt/v3";

/** Every language the endpoint accepts, in BCP-47. Drives the UI dropdown. */
export const LANGUAGES = [
  { code: "en-IN", label: "English (India)" },
  { code: "hi-IN", label: "Hindi" },
  { code: "bn-IN", label: "Bengali" },
  { code: "gu-IN", label: "Gujarati" },
  { code: "kn-IN", label: "Kannada" },
  { code: "ml-IN", label: "Malayalam" },
  { code: "mr-IN", label: "Marathi" },
  { code: "pa-IN", label: "Punjabi" },
  { code: "ta-IN", label: "Tamil" },
  { code: "te-IN", label: "Telugu" },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]["code"];

export function isLanguageCode(value: string): value is LanguageCode {
  return LANGUAGES.some((l) => l.code === value);
}

/** Retry policy. Waits double each time, so 1s, 2s, 4s. */
const MAX_ATTEMPTS = 4; // one initial try plus three retries
const BASE_BACKOFF_MS = 1_000;
/** A single chunk is at most 30s of audio; anything slower than this is stuck. */
const REQUEST_TIMEOUT_MS = 60_000;

export class GnaniError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    /**
     * Transient failures are worth retrying; permanent ones never succeed.
     * The pipeline surfaces permanent failures to the user immediately rather
     * than making them wait out a backoff schedule for a foregone conclusion.
     */
    readonly transient: boolean,
    readonly attempts = 1,
  ) {
    super(message);
    this.name = "GnaniError";
  }
}

/**
 * 429 (rate limited), 500 (their bug) and 503 (overloaded or down) can all
 * clear on their own. So can a dropped socket or a timeout, which arrive as
 * exceptions rather than status codes.
 *
 * 400 (bad audio) and 401 (bad key) cannot. Neither can 404. Retrying those
 * is pure waste, and in the 401 case it would be waste at scale -- every chunk
 * in the fan-out failing four times over.
 */
function isTransientStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503;
}

/** Turns a status code into something worth showing a human. */
function explain(status: number, body: string): string {
  switch (status) {
    case 400:
      return "The transcription service rejected this audio segment as invalid.";
    case 401:
    case 403:
      return "The transcription service rejected our API key.";
    case 429:
      return "The transcription service is rate limiting us.";
    case 500:
    case 502:
      return "The transcription service had an internal error.";
    case 503:
      return "The transcription service is temporarily unavailable.";
    default:
      return `The transcription service returned ${status}: ${body.slice(0, 200)}`;
  }
}

export interface TranscribeOptions {
  language: LanguageCode;
  /**
   * `verbatim` writes exactly what was said, filler words and all.
   * `transcribe` enables ITN (inverse text normalisation), so "twenty five"
   * becomes "25" and dates come out in written form. Notes and summaries read
   * far better with ITN on, so that is our default.
   */
  format?: "verbatim" | "transcribe";
  signal?: AbortSignal;
}

export interface TranscriptResult {
  transcript: string;
  requestId: string | null;
  attempts: number;
}

function apiKey(): string {
  const key = process.env.GNANI_API_KEY;
  if (!key) {
    // Thrown as permanent on purpose: no amount of retrying conjures a key.
    throw new GnaniError("GNANI_API_KEY is not configured.", null, false);
  }
  return key;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Transcribes one chunk, retrying transient failures with exponential backoff.
 *
 * Retries live here rather than in the caller so that the fan-out stays simple:
 * it launches N of these and each one either eventually produces text or
 * reports a failure that is genuinely final.
 */
export async function transcribeChunk(
  audio: Uint8Array | Blob,
  filename: string,
  { language, format = "transcribe", signal }: TranscribeOptions,
): Promise<TranscriptResult> {
  const key = apiKey();
  let lastError: GnaniError | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // The body is rebuilt per attempt: a FormData carrying a stream cannot be
    // safely resent once consumed.
    const body = new FormData();
    const blob =
      audio instanceof Blob
        ? audio
        : new Blob([audio as BlobPart], { type: "audio/wav" });
    body.append("audio_file", blob, filename);
    body.append("language_code", language);
    body.append("format", format);

    // Two ways to give up: the caller aborting, and our own timeout. Both feed
    // one signal so whichever fires first wins.
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const combined = signal
      ? AbortSignal.any([signal, timeout])
      : timeout;

    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "X-API-Key-ID": key },
        body,
        signal: combined,
      });

      if (res.ok) {
        const json = (await res.json()) as {
          success?: boolean;
          request_id?: string;
          transcript?: string;
        };
        // A 200 that says success:false is still a failure, just a politer one.
        if (json.success === false) {
          throw new GnaniError(
            "The transcription service reported failure for this segment.",
            res.status,
            false,
            attempt,
          );
        }
        return {
          transcript: (json.transcript ?? "").trim(),
          requestId: json.request_id ?? null,
          attempts: attempt,
        };
      }

      const text = await res.text().catch(() => "");
      lastError = new GnaniError(
        explain(res.status, text),
        res.status,
        isTransientStatus(res.status),
        attempt,
      );
    } catch (err) {
      // A caller-initiated abort is a decision, not a failure to retry around.
      if (signal?.aborted) throw err;

      if (err instanceof GnaniError) {
        if (!err.transient) throw err;
        lastError = err;
      } else {
        // Network-level failures: DNS, connection reset, our own timeout.
        lastError = new GnaniError(
          err instanceof Error && err.name === "TimeoutError"
            ? "The transcription service did not respond in time."
            : "Could not reach the transcription service.",
          null,
          true,
          attempt,
        );
      }
    }

    if (!lastError.transient) throw lastError;
    if (attempt === MAX_ATTEMPTS) break;

    // 1s, then 2s, then 4s. Doubling gives an overloaded service room to
    // recover instead of being stampeded by our fan-out all at once.
    //
    // Production would add jitter here -- a small random offset so that many
    // clients failing simultaneously do not retry in lockstep. With a single
    // instance and concurrency 4 there is no stampede to spread out.
    await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
  }

  throw new GnaniError(
    lastError!.message,
    lastError!.status,
    true,
    MAX_ATTEMPTS,
  );
}
