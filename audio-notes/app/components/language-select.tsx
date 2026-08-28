"use client";

/**
 * The language picker, as a custom listbox instead of a native <select> so
 * the open/close can be animated (framer-motion): the panel springs open
 * with a slight rise and scale, options stagger in, and the selected row
 * carries a check. Trigger keeps the design system's .input pill look.
 *
 * Native <select> keyboard behaviour is preserved where it matters:
 * Enter/Space/arrows open, arrows move, Enter picks, Escape closes, and
 * clicking anywhere else dismisses.
 */
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useId, useRef, useState } from "react";

import { LANGUAGES, type LanguageCode } from "@/lib/gnani";

export function LanguageSelect({
  value,
  onChange,
  disabled,
}: {
  value: LanguageCode;
  onChange: (code: LanguageCode) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(() =>
    Math.max(0, LANGUAGES.findIndex((l) => l.code === value)),
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  const pick = (code: LanguageCode) => {
    onChange(code);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        setActive(Math.max(0, LANGUAGES.findIndex((l) => l.code === value)));
        setOpen(true);
      }
      return;
    }
    if (e.key === "Escape") setOpen(false);
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(LANGUAGES.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(LANGUAGES[active].code);
    }
  };

  const current = LANGUAGES.find((l) => l.code === value);

  return (
    <div ref={rootRef} className="relative" onKeyDown={onKeyDown}>
      <button
        type="button"
        className="input flex w-full cursor-pointer items-center justify-between gap-2 text-left"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        style={disabled ? { opacity: 0.55, cursor: "not-allowed" } : undefined}
      >
        <span>{current?.label ?? value}</span>
        <motion.svg
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 30 }}
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--color-neutral-600)"
          strokeWidth="2.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </motion.svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.ul
            id={listboxId}
            role="listbox"
            initial={{ opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 480, damping: 34 }}
            className="absolute bottom-full left-0 z-30 mb-2 max-h-72 w-full min-w-56 origin-bottom overflow-auto p-1.5"
            style={{
              listStyle: "none",
              margin: 0,
              marginBottom: 8,
              background: "var(--color-neutral-100)",
              border: "1px solid var(--color-divider)",
              borderRadius: "var(--radius-md)",
              boxShadow: "var(--shadow-lg)",
            }}
          >
            {LANGUAGES.map((l, i) => {
              const selected = l.code === value;
              return (
                <motion.li
                  key={l.code}
                  role="option"
                  aria-selected={selected}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.02 * i, duration: 0.16 }}
                  onPointerEnter={() => setActive(i)}
                  onClick={() => pick(l.code)}
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-full px-3.5 py-2 text-sm"
                  style={{
                    background:
                      i === active
                        ? "var(--color-accent-100)"
                        : "transparent",
                    color: selected
                      ? "var(--color-accent-800)"
                      : "var(--color-text)",
                    fontWeight: selected ? 600 : 400,
                  }}
                >
                  {l.label}
                  {selected && (
                    <motion.svg
                      layoutId="lang-check"
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="var(--color-accent-700)"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="m5 13 4 4L19 7" />
                    </motion.svg>
                  )}
                </motion.li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
