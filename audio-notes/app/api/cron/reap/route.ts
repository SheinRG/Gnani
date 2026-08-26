/**
 * The scheduled half of the stale-job reaper (decision #3).
 *
 * A job dies without a trace when its function instance is killed mid-run --
 * deploy, crash, timeout. The note then sits in 'processing' forever, and the
 * poller spins on it. Two sweepers close that hole: an opportunistic one in
 * GET /api/notes (fires whenever someone looks at their history) and this
 * cron for notes nobody is looking at. Both run the same UPDATE; both are
 * idempotent.
 *
 * Vercel Cron calls this with the CRON_SECRET as a bearer token; anything
 * else is turned away so random visitors cannot trigger scans.
 */
import { NextResponse } from "next/server";

import { reapStaleNotes } from "@/lib/db";

const STALE_AFTER_MINUTES = 15;

export async function GET(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const reaped = await reapStaleNotes(STALE_AFTER_MINUTES);
  return NextResponse.json({ reaped });
}
