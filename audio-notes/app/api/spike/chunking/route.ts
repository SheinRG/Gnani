/**
 * THROWAWAY DIAGNOSTIC -- delete alongside /api/spike once the real pipeline
 * is proven in production.
 *
 * The sibling spike proves the ffmpeg binaries execute at all. This one proves
 * the part the design actually rests on: that `silencedetect` finds pauses and
 * that we cut at them rather than through words.
 *
 * It synthesises audio with pauses in *known* positions -- 8 seconds of tone,
 * 2 seconds of silence, repeating -- so the expected answer is arithmetic
 * rather than opinion. Every chunk boundary must land inside one of those
 * silent windows.
 */
import { NextResponse } from "next/server";
import path from "node:path";

import {
  probe,
  detectSilences,
  planChunks,
  extractChunk,
  workspace,
  HARD_CAP_MS,
  formatMs,
} from "@/lib/audio";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TOTAL_SECONDS = 120;
/** Tone for 8s then silence for 2s, on a 10s cycle. */
const CYCLE_SECONDS = 10;
const TONE_SECONDS = 8;

export async function GET() {
  const started = Date.now();
  const checks: Record<string, unknown> = {};

  try {
    const dir = await workspace();

    // A sine wave gated by a volume expression: audible for the first 8s of
    // every 10s cycle, silent for the last 2s. `eval=frame` re-evaluates the
    // expression continuously instead of once at initialisation.
    const src = path.join(dir, "gated.wav");
    await ffmpegSynthesise(src);

    // 1. Pre-flight, exactly as the real pipeline runs it.
    const info = await probe(src);
    checks.probe = { ...info, human: formatMs(info.durationMs) };

    // 2. Where did it hear pauses? Expect one per cycle, minus the last if
    //    the file happens to end mid-tone.
    const silences = await detectSilences(src);
    checks.silencesFound = silences.length;
    checks.expectedSilences = Math.floor(TOTAL_SECONDS / CYCLE_SECONDS);
    checks.firstThreeSilences = silences.slice(0, 3);

    // 3. Plan the cuts.
    const plans = planChunks(info.durationMs, silences);
    checks.chunkCount = plans.length;
    checks.plans = plans.map((p) => ({
      idx: p.idx,
      start: formatMs(p.startMs),
      end: formatMs(p.endMs),
      lengthMs: p.endMs - p.startMs,
      forced: p.forced,
    }));

    // 4. The two invariants that matter.
    //    (a) No chunk may exceed the API ceiling.
    const overCap = plans.filter((p) => p.endMs - p.startMs > HARD_CAP_MS);
    checks.chunksOverCap = overCap.length;

    //    (b) Every internal boundary must sit inside a real pause. The final
    //        boundary is the end of the file, which is not a cut at all.
    const internal = plans.slice(0, -1);
    const boundariesInSilence = internal.filter((p) =>
      silences.some((s) => p.endMs >= s.startMs && p.endMs <= s.endMs),
    ).length;
    checks.internalBoundaries = internal.length;
    checks.boundariesLandingInSilence = boundariesInSilence;
    checks.forcedCuts = plans.filter((p) => p.forced).length;

    // 5. Actually cut one, to prove extraction works and lands where promised.
    const sample = plans[1] ?? plans[0];
    const cut = path.join(dir, `chunk-${sample.idx}.wav`);
    await extractChunk(src, cut, sample.startMs, sample.endMs);
    const cutInfo = await probe(cut);
    checks.extracted = {
      requestedMs: sample.endMs - sample.startMs,
      actualMs: cutInfo.durationMs,
      sampleRate: cutInfo.sampleRate,
      channels: cutInfo.channels,
      codec: cutInfo.codec,
    };

    // Extraction is re-encoded, so allow a frame or two of slack.
    const driftMs = Math.abs(
      cutInfo.durationMs - (sample.endMs - sample.startMs),
    );
    checks.extractionDriftMs = driftMs;

    const pass =
      overCap.length === 0 &&
      boundariesInSilence === internal.length &&
      cutInfo.sampleRate === 16000 &&
      cutInfo.channels === 1 &&
      driftMs < 250;

    checks.verdict = pass
      ? "PASS -- pauses detected, every cut landed in silence, extraction is 16kHz mono and on-target"
      : "FAIL -- see chunksOverCap / boundariesLandingInSilence / extracted";

    return NextResponse.json({
      ok: pass,
      elapsedMs: Date.now() - started,
      ...checks,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        elapsedMs: Date.now() - started,
        ...checks,
        failedAfter: Object.keys(checks),
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

/** Builds the gated tone described at the top of this file. */
async function ffmpegSynthesise(dest: string) {
  const { ffmpeg } = await import("@/lib/ffmpeg");
  await ffmpeg([
    "-f", "lavfi",
    "-i", `sine=frequency=440:duration=${TOTAL_SECONDS}`,
    "-af",
    `volume=enable='lt(mod(t\\,${CYCLE_SECONDS})\\,${TONE_SECONDS})':volume=1,` +
      `volume=enable='gte(mod(t\\,${CYCLE_SECONDS})\\,${TONE_SECONDS})':volume=0`,
    "-ar", "16000",
    "-ac", "1",
    "-y", dest,
  ]);
}
