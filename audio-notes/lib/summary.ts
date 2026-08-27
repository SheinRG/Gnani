/**
 * Turns a finished transcript into structured notes.
 *
 * `generateObject` + a zod schema instead of free-form prose, because the UI
 * renders named fields (title, TL;DR, key points, action items) and a schema
 * makes "the model returned something unrenderable" a caught error instead of
 * a broken page.
 *
 * Provider note: the original design routed through Vercel AI Gateway, but
 * the Gateway refuses requests until a credit card is on file. Google's
 * Gemini API has a card-free tier, so we call it directly through the AI
 * SDK's Google provider instead -- the provider choice is confined to this
 * module, so swapping back is a two-line change. Models are tried in order:
 * if the first is down or over quota, the next gets a chance. The summary
 * failing entirely must never sink the note -- a transcript without a summary
 * is still a useful artifact, so the caller treats a null summary as a
 * degradation, not a failure.
 */
import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";

import type { NoteSummary } from "./db";

const SummarySchema = z.object({
  title: z
    .string()
    .describe("A short descriptive title for the recording, under 10 words"),
  tldr: z.string().describe("Two to three sentences capturing the essence"),
  keyPoints: z
    .array(z.string())
    .min(1)
    .max(8)
    .describe("The main points discussed, most important first"),
  actionItems: z
    .array(z.string())
    .max(8)
    .describe(
      "Concrete follow-ups or tasks mentioned; empty if there are none",
    ),
});

/** Tried in order. Both are fast, free-tier, and fit the token budget. */
const MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];

export async function summarize(
  transcript: string,
  language: string,
): Promise<NoteSummary | null> {
  // A transcript from a 10-minute recording is ~10k characters; well within
  // any context window, so no truncation logic is needed.
  const prompt =
    `Summarize this voice-note transcript. It was spoken in ${language}. ` +
    `Write the summary in the same language as the transcript. ` +
    `The transcript may contain gap markers like ` +
    `"[audio unavailable 1:02-1:29]" where transcription failed; do not ` +
    `invent content for those gaps.\n\nTranscript:\n${transcript}`;

  for (const model of MODELS) {
    try {
      const { object } = await generateObject({
        model: google(model),
        schema: SummarySchema,
        prompt,
      });
      return object;
    } catch (err) {
      console.error(`summary via ${model} failed:`, err);
    }
  }
  return null;
}
