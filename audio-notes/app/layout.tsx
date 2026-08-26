import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Gnani Audio Notes",
  description:
    "Upload a recording, get a transcript and structured notes. Built on Gnani's speech-to-text.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <header className="border-b border-black/10 dark:border-white/15">
          <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-4">
            <Link href="/" className="font-semibold tracking-tight">
              Gnani <span className="text-emerald-600 dark:text-emerald-400">Audio Notes</span>
            </Link>
            <nav className="flex items-center gap-5 text-sm text-black/60 dark:text-white/60">
              <Link href="/" className="hover:text-black dark:hover:text-white">
                Notes
              </Link>
              <Link
                href="/architecture"
                className="hover:text-black dark:hover:text-white"
              >
                Architecture
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
