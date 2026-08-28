"use client";

/** Header navigation: the active route renders as a filled pill. */
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Notes" },
  { href: "/architecture", label: "Architecture" },
] as const;

export function NavPills() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-2 text-sm">
      {LINKS.map(({ href, label }) => {
        const active =
          href === "/" ? pathname === "/" || pathname.startsWith("/notes") : pathname.startsWith(href);
        return active ? (
          <span
            key={href}
            className="rounded-full px-3.5 py-[7px] font-semibold"
            style={{
              background: "var(--color-accent-200)",
              color: "var(--color-accent-800)",
            }}
          >
            {label}
          </span>
        ) : (
          <Link
            key={href}
            href={href}
            className="rounded-full px-3.5 py-[7px] font-medium transition-colors hover:bg-[var(--color-neutral-200)]"
            style={{ color: "var(--color-neutral-700)" }}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
