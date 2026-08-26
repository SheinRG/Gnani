/**
 * Display formatting shared by server and client. Lives apart from lib/audio
 * because that module imports the ffmpeg binaries, which must never end up in
 * a client bundle.
 */

/** 432000 -> "7:12". Used in gap markers, chunk labels and error messages. */
export function formatMs(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** 41943040 -> "40.0 MB" */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
