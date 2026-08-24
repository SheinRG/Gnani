/**
 * THROWAWAY DIAGNOSTIC -- delete once the pipeline is proven in production.
 *
 * Answers one question we cannot answer locally: does a bundled ffmpeg binary
 * actually execute inside a deployed serverless function, and can it write
 * output? It runs the same four operations the real pipeline depends on:
 *
 *   1. execute the binaries at all       (bundling + permissions)
 *   2. write to the temp directory       (read-only filesystem)
 *   3. probe a file for its duration     (pre-flight validation)
 *   4. split audio into timed segments   (chunking)
 *
 * It needs no input file: ffmpeg's `lavfi` virtual input can synthesise a
 * tone, so the test is self-contained.
 */
import { NextResponse } from "next/server";
import { mkdtemp, readdir, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { ffmpeg, ffprobe, BinaryError } from "@/lib/ffmpeg";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TONE_SECONDS = 90;
const SEGMENT_SECONDS = 30;

export async function GET() {
  const started = Date.now();
  const checks: Record<string, unknown> = {};

  try {
    // 1. Can we run them, and which builds got deployed?
    checks.ffmpegVersion = (await ffmpeg(["-version"])).stdout
      .split("\n")[0]
      .trim();
    checks.ffprobeVersion = (await ffprobe(["-version"])).stdout
      .split("\n")[0]
      .trim();
    checks.platform = `${process.platform}/${process.arch}`;

    // 2. Is there anywhere to write?
    const dir = await mkdtemp(path.join(os.tmpdir(), "spike-"));
    checks.tmpDir = dir;

    // 3. Synthesise 90s of 16kHz mono audio -- the format Gnani expects.
    const src = path.join(dir, "tone.wav");
    await ffmpeg([
      "-f", "lavfi",
      "-i", `sine=frequency=440:duration=${TONE_SECONDS}`,
      "-ar", "16000",
      "-ac", "1",
      "-y", src,
    ]);
    checks.generatedBytes = (await stat(src)).size;

    // 4. Probe it -- this is exactly the pre-flight check the pipeline runs.
    const probe = await ffprobe([
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "json",
      src,
    ]);
    checks.probedDuration = Number(
      JSON.parse(probe.stdout).format.duration,
    ).toFixed(2);

    // 5. Split into 30s segments -- the chunking step, minus silence detection.
    await ffmpeg([
      "-i", src,
      "-f", "segment",
      "-segment_time", String(SEGMENT_SECONDS),
      "-c", "copy",
      "-y", path.join(dir, "chunk-%03d.wav"),
    ]);
    const segments = (await readdir(dir)).filter((f) =>
      f.startsWith("chunk-"),
    );
    checks.segmentCount = segments.length;
    checks.segments = segments;

    const expected = Math.ceil(TONE_SECONDS / SEGMENT_SECONDS);
    checks.verdict =
      segments.length === expected
        ? "PASS -- ffmpeg, ffprobe, tmp writes and segmenting all work here"
        : `FAIL -- expected ${expected} segments, produced ${segments.length}`;

    return NextResponse.json({
      ok: segments.length === expected,
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
        diagnosis: diagnose(err),
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

/** Translates the three failure modes we actually expect into plain English. */
function diagnose(err: unknown): string {
  if (err instanceof BinaryError) return err.message;

  const code = (err as NodeJS.ErrnoException)?.code;
  switch (code) {
    case "ENOENT":
      return "Binary was not deployed -- outputFileTracingIncludes is wrong.";
    case "EACCES":
    case "EPERM":
      return "Binary deployed but is not executable, and the tmp-copy repair also failed.";
    case "EROFS":
      return "Tried to write to a read-only path -- all output must go to os.tmpdir().";
    case "ETIMEDOUT":
      return "ffmpeg exceeded its timeout.";
    default:
      return `Unrecognised failure (code: ${code ?? "none"}).`;
  }
}
