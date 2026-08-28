/**
 * The one visual vocabulary for note status, from the approved design:
 * tag class for the pill, dot colors for the row's icon circle.
 */
export const STATUS_STYLE: Record<
  string,
  { label: string; tagClass: string; dotBg: string; dotFg: string }
> = {
  processing: {
    label: "Working…",
    tagClass: "tag-accent",
    dotBg: "var(--color-accent-200)",
    dotFg: "var(--color-accent-800)",
  },
  completed: {
    label: "Ready",
    tagClass: "tag-accent-2",
    dotBg: "var(--color-accent-2-200)",
    dotFg: "var(--color-accent-2-800)",
  },
  completed_with_errors: {
    label: "Gaps",
    tagClass: "tag-outline",
    dotBg: "var(--color-accent-200)",
    dotFg: "var(--color-accent-800)",
  },
  failed: {
    label: "Failed",
    tagClass: "tag-neutral",
    dotBg: "var(--color-neutral-200)",
    dotFg: "var(--color-neutral-700)",
  },
};

export function StatusBadge({ status }: { status: string }) {
  const st = STATUS_STYLE[status] ?? STATUS_STYLE.processing;
  return (
    <span
      className={`tag ${st.tagClass} shrink-0 font-semibold`}
      style={status === "processing" ? { animation: "gn-pulse 2s ease-in-out infinite" } : undefined}
    >
      {st.label}
    </span>
  );
}
