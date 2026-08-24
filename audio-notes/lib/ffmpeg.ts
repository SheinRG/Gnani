/**
 * Resolves and executes the bundled ffmpeg / ffprobe binaries.
 *
 * Why this file exists: ffmpeg is a command-line *program*, not a library. We
 * ship it as an npm package containing a platform-specific executable, then
 * spawn it as a child process. Two things make that awkward on serverless:
 *
 *   1. The deployment bundler only includes files it can see via `import`.
 *      The static imports below are load-bearing -- they are what tells the
 *      bundler these packages must be deployed. (next.config.ts also declares
 *      them explicitly, because the *binary* sits next to the JS entrypoint
 *      and is not itself imported.)
 *
 *   2. The deployed filesystem is read-only apart from the OS temp directory,
 *      and packaging can strip the executable permission bit. So if we get
 *      EACCES we copy the binary into tmp, mark it executable, and retry.
 */
import { execFile } from "node:child_process";
import { copyFile, chmod, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import ffmpegStatic from "ffmpeg-static";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";

export type BinaryKind = "ffmpeg" | "ffprobe";

/** Where the npm packages claim their binaries live. */
const DECLARED_PATH: Record<BinaryKind, string | null> = {
  ffmpeg: ffmpegStatic as unknown as string | null,
  ffprobe: ffprobeInstaller.path,
};

/**
 * Cache of usable paths, keyed by binary. Serverless instances are reused
 * between requests, so a binary we already repaired stays repaired for the
 * life of the instance.
 */
const resolved = new Map<BinaryKind, string>();

export class BinaryError extends Error {
  constructor(
    message: string,
    readonly kind: BinaryKind,
    readonly code?: string,
  ) {
    super(message);
    this.name = "BinaryError";
  }
}

/**
 * Copy a binary into the writable temp directory and mark it executable.
 * Used only as a fallback when the deployed copy cannot be run in place.
 */
async function makeExecutableCopy(kind: BinaryKind, src: string) {
  const dir = path.join(os.tmpdir(), "bin");
  await mkdir(dir, { recursive: true });
  const dest = path.join(dir, path.basename(src));
  await copyFile(src, dest);
  await chmod(dest, 0o755);
  return dest;
}

/**
 * Returns a path to a binary that is known to actually execute.
 * Verifies by running `-version`, which is cheap and side-effect free.
 */
export async function binary(kind: BinaryKind): Promise<string> {
  const cached = resolved.get(kind);
  if (cached) return cached;

  const declared = DECLARED_PATH[kind];
  if (!declared) {
    throw new BinaryError(
      `${kind} package resolved to no path -- it likely failed to install a ` +
        `build for this platform.`,
      kind,
    );
  }

  try {
    await execute(declared, ["-version"]);
    resolved.set(kind, declared);
    return declared;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;

    // EACCES: the file is there but not marked executable. Repairable.
    if (code === "EACCES" || code === "EPERM") {
      const repaired = await makeExecutableCopy(kind, declared);
      await execute(repaired, ["-version"]);
      resolved.set(kind, repaired);
      return repaired;
    }

    // ENOENT: the file was never deployed. Not repairable at runtime -- this
    // means the bundler tracing config is wrong.
    if (code === "ENOENT") {
      throw new BinaryError(
        `${kind} binary is missing at ${declared}. The deployment did not ` +
          `include it; check outputFileTracingIncludes in next.config.ts.`,
        kind,
        code,
      );
    }

    throw err;
  }
}

export interface ExecResult {
  stdout: string;
  stderr: string;
}

/**
 * Runs a binary and buffers its output.
 *
 * Note ffmpeg writes its banner, progress and diagnostics to *stderr*, not
 * stdout -- stdout is reserved for piped media data. So a successful run
 * normally produces a large stderr and an empty stdout. Callers that want
 * information from ffmpeg (durations, silence positions) must read stderr.
 */
export function execute(
  bin: string,
  args: string[],
  timeoutMs = 120_000,
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          // Attach ffmpeg's own explanation, which lives in stderr and is far
          // more useful than the generic "Command failed" from Node.
          if (stderr) err.message = `${err.message}\n${stderr.slice(-2000)}`;
          reject(err);
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

/** Convenience wrappers. */
export const ffmpeg = (args: string[], timeoutMs?: number) =>
  binary("ffmpeg").then((bin) => execute(bin, args, timeoutMs));

export const ffprobe = (args: string[], timeoutMs?: number) =>
  binary("ffprobe").then((bin) => execute(bin, args, timeoutMs));
