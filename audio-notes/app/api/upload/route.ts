/**
 * Issues short-lived client tokens for direct browser-to-Blob uploads.
 *
 * Decision #4: the file goes from the browser straight to Blob storage, not
 * through this server. Two reasons. A 40 MB body would eat most of a
 * serverless request's memory and time budget for pure byte-shuffling. And
 * only a direct upload gives the browser real byte-level progress events --
 * the brief demands a real progress counter, and "real" starts at upload.
 *
 * This route never sees audio bytes. It authenticates the *intent* to upload:
 * checks the session, constrains size and content type, and stamps the token
 * so the blob is tied to the session that requested it.
 */
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

import { ensureSession } from "@/lib/session";
import { MAX_BYTES } from "@/lib/audio";

export async function POST(request: Request): Promise<NextResponse> {
  const sessionId = await ensureSession();
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        // Browsers report audio MIME types inconsistently (webm recordings,
        // x-m4a, octet-stream from some pickers), so the reliable gate is the
        // ffprobe pre-flight after upload. This list just blocks the obvious
        // non-audio picks early.
        allowedContentTypes: [
          "audio/*",
          "video/mp4",
          "video/webm",
          "application/octet-stream",
        ],
        maximumSizeInBytes: MAX_BYTES,
        addRandomSuffix: true,
        tokenPayload: JSON.stringify({ sessionId }),
      }),
      // Fires via webhook once the blob lands. Note creation happens in
      // POST /api/notes driven by the client instead, because this callback
      // cannot reach localhost during development and the client has to make
      // a request anyway to learn its note id.
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(jsonResponse);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload refused." },
      { status: 400 },
    );
  }
}
