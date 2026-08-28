import type { Metadata } from "next";
import { Figtree } from "next/font/google";
import Link from "next/link";
import "./globals.css";

import { NavPills } from "./components/nav-pills";

const figtree = Figtree({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Gnani Audio Notes",
  description:
    "Upload a recording, get a transcript and structured notes. Built on Gnani's speech-to-text.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${figtree.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <header
          className="sticky top-0 z-20 backdrop-blur-[8px]"
          style={{
            background: "color-mix(in srgb, var(--color-bg) 88%, transparent)",
            borderBottom: "1px solid var(--color-divider)",
          }}
        >
          <div className="mx-auto flex w-full max-w-[960px] items-center justify-between gap-4 px-6 py-3.5">
            <Link href="/" className="flex items-center gap-2.5">
              <span
                className="grid h-[34px] w-[34px] place-items-center rounded-full"
                style={{
                  background: "var(--color-accent)",
                  color: "var(--color-neutral-100)",
                  boxShadow: "var(--shadow-sm)",
                }}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 19v3" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <rect x="9" y="2" width="6" height="13" rx="3" />
                </svg>
              </span>
              <span
                className="text-lg font-extrabold tracking-[-0.2px]"
                style={{ color: "var(--color-text)" }}
              >
                Gnani{" "}
                <span style={{ color: "var(--color-accent-700)" }}>
                  Audio Notes
                </span>
              </span>
            </Link>
            <NavPills />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[960px] flex-1 px-6 pb-22 pt-11">
          {children}
        </main>
      </body>
    </html>
  );
}
