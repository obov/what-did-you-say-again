// Read-only access to Codex's SQLite stores (codex-rs/state/src/sqlite.rs).
//   state_5.sqlite          threads: id · cwd · title · rollout_path · history_mode
//   thread_history_1.sqlite thread_items: userMessage / agentMessage items of paginated threads
// Any failure (old Node without node:sqlite, missing file, schema change) returns undefined
// so the caller falls back to scanning rollout jsonl files.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const STATE_DB = 'state_5.sqlite';
export const HISTORY_DB = 'thread_history_1.sqlite';

let sqlite;
async function loadSqlite() {
  if (sqlite !== undefined) return sqlite;
  // Older Node versions print an ExperimentalWarning for node:sqlite; keep stderr clean.
  const emit = process.emitWarning;
  process.emitWarning = (warning, ...rest) => {
    const type = typeof rest[0] === 'string' ? rest[0] : rest[0]?.type;
    if (type === 'ExperimentalWarning' && String(warning).includes('SQLite')) return;
    return emit.call(process, warning, ...rest);
  };
  try {
    sqlite = await import('node:sqlite');
  } catch {
    sqlite = null;
  } finally {
    process.emitWarning = emit;
  }
  return sqlite;
}

const cache = new Map();

/** Open a DB read-only (cached per path). undefined if unavailable. */
export async function openDb(dir, name) {
  const file = join(dir, name);
  if (cache.has(file)) return cache.get(file);
  let db;
  const mod = await loadSqlite();
  if (mod && existsSync(file)) {
    try {
      db = new mod.DatabaseSync(file, { readOnly: true });
    } catch {
      db = undefined;
    }
  }
  cache.set(file, db);
  return db;
}

/** Run a query, undefined on any error. */
export function query(db, sql, ...params) {
  if (!db) return undefined;
  try {
    return db.prepare(sql).all(...params);
  } catch {
    return undefined;
  }
}
