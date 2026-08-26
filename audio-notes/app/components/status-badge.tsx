/** The one visual vocabulary for note status, shared by history and detail. */
export function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    processing:
      "bg-amber-500/15 text-amber-700 dark:text-amber-400 animate-pulse",
    completed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    completed_with_errors:
      "bg-orange-500/15 text-orange-700 dark:text-orange-400",
    failed: "bg-red-500/15 text-red-700 dark:text-red-400",
  };
  const labels: Record<string, string> = {
    processing: "Processing",
    completed: "Done",
    completed_with_errors: "Done, with gaps",
    failed: "Failed",
  };
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${styles[status] ?? "bg-black/10 dark:bg-white/10"}`}
    >
      {labels[status] ?? status}
    </span>
  );
}
