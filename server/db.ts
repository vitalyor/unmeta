// The bot's memory: what arrived, what was asked, what happened. A week of IDs, statuses and errors, so a restart
// loses nothing, nothing runs twice, and a failure can be looked up. No file contents, ever; a file's name and
// Telegram id live here only until the job ends (or a week, if nobody presses the button).
import { DatabaseSync } from 'node:sqlite';

export const WEEK = 7 * 24 * 3600 * 1000;

export type JobStatus = 'seen' | 'offered' | 'queued' | 'running' | 'sending' | 'done' | 'nothing' | 'skipped' | 'failed';
export const LIVE = `('queued','running','sending')`;
export const ENDED = `('done','nothing','skipped','failed')`;

export interface Job {
  id: number; chat_id: number; thread_id: number | null; message_id: number; user_id: number; lang: string;
  file_id: string | null; file_name: string | null; file_size: number; photo: number; batch_id: number;
  status: JobStatus; attempts: number; next_at: number; error: string | null; result_id: number | null; shape: string | null; album: string | null;
  created_at: number; updated_at: number;
}
export interface Batch {
  id: number; chat_id: number; thread_id: number | null; user_id: number; lang: string; reply_to: number;
  status: 'open' | 'offered' | 'queued' | 'finished'; prompt_id: number | null; last_at: number; last_edit: number;
  shown: number; created_at: number; updated_at: number;
}

export function openDb(path: string) {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS batches (
      id INTEGER PRIMARY KEY, chat_id INTEGER NOT NULL, thread_id INTEGER, user_id INTEGER NOT NULL, lang TEXT NOT NULL,
      reply_to INTEGER NOT NULL, status TEXT NOT NULL, prompt_id INTEGER, last_at INTEGER NOT NULL,
      last_edit INTEGER NOT NULL DEFAULT 0, shown INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY, chat_id INTEGER NOT NULL, thread_id INTEGER, message_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL, lang TEXT NOT NULL, file_id TEXT, file_name TEXT, file_size INTEGER NOT NULL DEFAULT 0,
      photo INTEGER NOT NULL DEFAULT 0, batch_id INTEGER NOT NULL REFERENCES batches(id), status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0, error TEXT, result_id INTEGER, shape TEXT, album TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE (chat_id, message_id)
    );
    CREATE INDEX IF NOT EXISTS jobs_status ON jobs (status, next_at);
    CREATE INDEX IF NOT EXISTS jobs_batch ON jobs (batch_id);
    CREATE INDEX IF NOT EXISTS batches_status ON batches (status);
    DROP TABLE IF EXISTS muted;
    CREATE TABLE IF NOT EXISTS buttons (chat_id INTEGER NOT NULL, user_id INTEGER NOT NULL, PRIMARY KEY (chat_id, user_id)); -- who turned the button on
    CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT);
  `);
  try { db.exec('ALTER TABLE batches ADD COLUMN shown INTEGER NOT NULL DEFAULT 0'); } catch { /* already there */ }
  try { db.exec('ALTER TABLE jobs ADD COLUMN album TEXT'); } catch { /* already there */ }
  db.exec('CREATE INDEX IF NOT EXISTS jobs_album ON jobs (chat_id, album)');
  return db;
}
