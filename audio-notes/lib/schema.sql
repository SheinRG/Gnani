-- Gnani Audio Notes schema.
--
-- Two tables: one row per uploaded note, one row per audio chunk of that note.
-- The chunks table is what makes the progress counter and "retry failed
-- segments" real features instead of theatre: each chunk carries its own
-- status, so progress is a COUNT(*) and a retry is "re-run WHERE failed".
--
-- Applied by `npm run db:init` (scripts/db-init.mjs). Idempotent on purpose:
-- IF NOT EXISTS everywhere, so re-running is always safe.

CREATE TABLE IF NOT EXISTS notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Anonymous identity: the value of the httpOnly session cookie. No login.
  session_id  TEXT NOT NULL,

  -- 'processing' -> 'completed' | 'completed_with_errors' | 'failed'
  status      TEXT NOT NULL DEFAULT 'processing',
  -- Sub-state while processing, for an honest progress narrative:
  -- 'downloading' | 'probing' | 'chunking' | 'transcribing' | 'summarizing'
  stage       TEXT,
  -- Shown when status = 'failed'. Written for humans, not stack traces.
  error       TEXT,

  blob_url    TEXT NOT NULL,
  filename    TEXT NOT NULL,
  language    TEXT NOT NULL,
  duration_ms INTEGER,
  size_bytes  INTEGER,

  transcript  TEXT,
  -- { title, tldr, keyPoints[], actionItems[] } from generateObject.
  summary     JSONB,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- History page: "my notes, newest first".
CREATE INDEX IF NOT EXISTS notes_session_created
  ON notes (session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS chunks (
  note_id    UUID NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
  idx        INTEGER NOT NULL,

  start_ms   INTEGER NOT NULL,
  end_ms     INTEGER NOT NULL,
  -- True when no pause was found and we cut at the hard cap.
  forced     BOOLEAN NOT NULL DEFAULT FALSE,

  -- 'pending' -> 'done' | 'failed'
  status     TEXT NOT NULL DEFAULT 'pending',
  transcript TEXT,
  error      TEXT,
  attempts   INTEGER NOT NULL DEFAULT 0,
  -- Gnani's request_id, kept for debugging against their logs.
  request_id TEXT,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (note_id, idx)
);
