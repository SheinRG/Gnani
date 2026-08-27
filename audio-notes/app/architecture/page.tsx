/**
 * The written-up design, required by the brief alongside the app itself.
 * Static server-rendered prose; the source of truth it summarizes is the
 * concept guide in the repository's docs/.
 */
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Architecture · Gnani Audio Notes",
};

const REPO_URL = "https://github.com/SheinRG/Gnani";

export default function ArchitecturePage() {
  return (
    <article className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Architecture</h1>
        <p className="mt-2 text-sm text-black/60 dark:text-white/60">
          Source, commit history and the full concept guide live in the{" "}
          <a
            href={REPO_URL}
            className="font-medium text-emerald-600 underline underline-offset-2 dark:text-emerald-400"
          >
            GitHub repository
          </a>
          .
        </p>
      </header>

      <Section title="The problem this design solves">
        <p>
          Gnani&apos;s <code>/stt/v3</code> endpoint is synchronous and accepts
          at most 60 seconds of audio, while this app accepts recordings of ten
          minutes. The obvious implementation — one API call per file — is
          impossible by design. Everything interesting here follows from that
          gap: the audio is <strong>split into chunks and transcribed in
          parallel</strong>, and the system is built so that the seams of that
          split are invisible in the result.
        </p>
      </Section>

      <Section title="The pipeline">
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            <strong>Upload:</strong> the browser uploads directly to Vercel
            Blob with a short-lived scoped token from the server. The server
            never relays file bytes, and the browser gets true byte-level
            progress events.
          </li>
          <li>
            <strong>Pre-flight:</strong> <code>ffprobe</code> verifies the file
            is really audio and within the 10-minute / 40 MB limits — before
            any transcription credit is spent. A PDF renamed to .mp3 dies here
            in ~200 ms with a human-readable error.
          </li>
          <li>
            <strong>Silence-aware chunking:</strong> ffmpeg&apos;s{" "}
            <code>silencedetect</code> finds every pause; a pure planning
            function cuts at the pause nearest to 25 s, hard-capped at 30 s. A
            blind fixed-interval cut would slice through words and corrupt the
            transcript at every seam; cutting where the speaker breathed keeps
            words whole. If nobody pauses for 30 straight seconds we cut anyway
            — the API limit is not negotiable.
          </li>
          <li>
            <strong>Parallel transcription:</strong> a worker pool sends chunks
            to Gnani at concurrency 4. Transient failures (429 / 5xx / network)
            retry up to three times with exponential backoff; permanent ones
            (400) never retry — the audio will be exactly as rejected on the
            fourth attempt as the first.
          </li>
          <li>
            <strong>Summary:</strong> the stitched transcript goes through the
            AI SDK&apos;s <code>generateObject</code> against Gemini (with
            model fallback) into a fixed schema: title, TL;DR, key points,
            action items. A schema instead of free prose means a malformed
            response is a caught error, not a broken page.
          </li>
        </ol>
      </Section>

      <Section title="Background work without a queue">
        <p>
          The create-note request returns an id immediately; the pipeline runs
          in Next.js&apos;s <code>after()</code> on the same function
          invocation, writing every stage change and every chunk result to
          Postgres. The client polls every 2 seconds and renders exactly what
          the database says — the progress counter is a count of real rows,
          not an animation. A queue would add infrastructure this scale cannot
          justify; the trade-off is that a job must fit the function&apos;s
          time budget, which the 10-minute cap guarantees.
        </p>
      </Section>

      <Section title="Failure is a feature">
        <p>
          One dead segment must not sink a ten-minute recording. A chunk that
          exhausts its retries becomes a visible, timestamped gap marker in
          the transcript; the note completes as{" "}
          <em>done with gaps</em> and offers a retry that re-runs{" "}
          <strong>only the failed segments</strong> — already-transcribed audio
          is never re-billed. Jobs killed mid-flight (deploy, crash) are swept
          by a reaper — opportunistically on every history view, and on a
          schedule via Vercel Cron — so nothing spins forever.
        </p>
      </Section>

      <Section title="Stack">
        <ul className="list-disc space-y-1 pl-5">
          <li>Next.js 16 App Router on Vercel, TypeScript end to end</li>
          <li>Neon Postgres (HTTP driver — stateless, serverless-shaped)</li>
          <li>Vercel Blob for audio storage, direct browser upload</li>
          <li>Bundled ffmpeg/ffprobe binaries, spawned as child processes</li>
          <li>AI SDK + Gemini for the structured summary</li>
          <li>
            Anonymous httpOnly cookie session — every query is scoped to it;
            no accounts, nothing for a reviewer to sign up for
          </li>
        </ul>
      </Section>
    </article>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-black/80 dark:text-white/80">
        {children}
      </div>
    </section>
  );
}
