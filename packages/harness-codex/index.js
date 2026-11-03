import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { readFirstLine, readJsonl } from '@wdysa/core';
import { HISTORY_DB, STATE_DB, openDb, query } from './db.js';

const ROLLOUT = /^rollout-.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

/** Auto-injected user messages (environment context, AGENTS.md, instructions). */
const isInjected = (text) => text.startsWith('<') || text.startsWith('# AGENTS.md instructions');

const firstLine = (s) => (s ? String(s).split('\n')[0].trim() || undefined : undefined);

async function rollouts(dir) {
  let names;
  try {
    names = await readdir(dir, { recursive: true });
  } catch {
    return [];
  }
  return names.flatMap((rel) => {
    const m = ROLLOUT.exec(basename(rel));
    return m ? [{ id: m[1], file: join(dir, rel) }] : [];
  });
}

/** session_meta payload, or undefined. `hint` skips JSON parsing when a needle is absent. */
async function meta(file, hint) {
  try {
    const line = await readFirstLine(file);
    if (hint && !hint(line)) return undefined;
    const r = JSON.parse(line);
    return r.type === 'session_meta' ? r.payload : undefined;
  } catch {
    return undefined;
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Sessions come from Codex's state DB when available (fast), else from scanning rollout files.
 * Messages come from the thread history DB for paginated threads, else from the rollout file.
 *
 * Options:
 *   root        Codex home (default $CODEX_HOME or ~/.codex)
 *   sqliteHome  Folder of Codex's SQLite DBs (default $CODEX_SQLITE_HOME or root)
 *   sqlite      false to never use the SQLite DBs
 *   label       Speaker label (default "Codex")
 */
export default function codexPlugin(options = {}) {
  const home = () => options.root ?? process.env.CODEX_HOME ?? join(homedir(), '.codex');
  const sqliteHome = () => options.sqliteHome ?? (process.env.CODEX_SQLITE_HOME?.trim() || home());
  const db = (name) => (options.sqlite === false ? undefined : openDb(sqliteHome(), name));

  /** Sessions from the state DB, or undefined to fall back to file scanning. */
  async function fromState(where, params, withTitles) {
    const rows = query(
      await db(STATE_DB),
      `SELECT id, cwd, rollout_path, title, name, updated_at_ms, history_mode FROM threads WHERE archived = 0 AND ${where}`,
      ...params,
    );
    if (!rows) return undefined;
    return rows.map((r) => ({
      id: r.id,
      cwd: r.cwd,
      file: r.rollout_path,
      paginated: r.history_mode === 'paginated',
      updatedAt: r.updated_at_ms,
      title: withTitles ? r.name || firstLine(r.title) : undefined,
    }));
  }

  async function titles() {
    const map = new Map();
    try {
      for await (const r of readJsonl(join(home(), 'session_index.jsonl'))) {
        if (r.id && r.thread_name) map.set(r.id, r.thread_name);
      }
    } catch {}
    return map;
  }

  async function toSessions(files, keep, withTitles, hint) {
    const names = withTitles ? await titles() : new Map();
    const rows = await mapLimit(files, 32, async (f) => {
      const m = await meta(f.file, hint);
      if (!m || !keep(m)) return undefined;
      const st = await stat(f.file);
      return { id: f.id, cwd: m.cwd, file: f.file, updatedAt: st.mtime, title: names.get(f.id) };
    });
    return rows.filter(Boolean);
  }

  /** userMessage / agentMessage items of a paginated thread, or undefined. */
  async function readHistory(id) {
    const rows = query(
      await db(HISTORY_DB),
      `SELECT item_type, item_json, created_at_ms FROM thread_items
       WHERE thread_id = ? AND item_type IN ('userMessage', 'agentMessage') ORDER BY rollout_ordinal`,
      id,
    );
    if (!rows) return undefined;
    const messages = [];
    for (const r of rows) {
      let item;
      try {
        item = JSON.parse(r.item_json);
      } catch {
        continue;
      }
      const text =
        r.item_type === 'agentMessage'
          ? String(item.text ?? '')
          : (item.content ?? []).filter((c) => c?.type === 'text' && typeof c.text === 'string').map((c) => c.text).join('\n');
      const trimmed = text.trim();
      if (!trimmed || (r.item_type === 'userMessage' && isInjected(trimmed))) continue;
      messages.push({ role: r.item_type === 'userMessage' ? 'user' : 'agent', text: trimmed, time: r.created_at_ms });
    }
    return messages;
  }

  const harness = {
    name: 'codex',
    label: options.label ?? 'Codex',

    currentSessionId: () => process.env.CODEX_THREAD_ID,

    async list({ dirs, titles: withTitles }) {
      const fast = dirs.length
        ? await fromState(`cwd IN (${dirs.map(() => '?').join(', ')})`, dirs, withTitles)
        : [];
      if (fast) return fast;
      const wanted = new Set(dirs);
      const needles = dirs.map((d) => `"cwd":${JSON.stringify(d)}`);
      const hint = (line) => needles.some((n) => line.includes(n));
      return toSessions(await rollouts(join(home(), 'sessions')), (m) => wanted.has(m.cwd), withTitles, hint);
    },

    async find({ idPrefix }) {
      const fast = await fromState(`substr(id, 1, ?) = ?`, [idPrefix.length, idPrefix], true);
      if (fast) return fast;
      const files = (await rollouts(join(home(), 'sessions'))).filter((f) => f.id.startsWith(idPrefix));
      return toSessions(files, () => true, true);
    },

    async read(session) {
      if (session.paginated) {
        const fromHistory = await readHistory(session.id);
        if (fromHistory?.length) return fromHistory;
      }
      const messages = [];
      for await (const r of readJsonl(session.file)) {
        const p = r.payload;
        if (r.type !== 'response_item' || p?.type !== 'message') continue;
        const want = p.role === 'user' ? 'input_text' : p.role === 'assistant' ? 'output_text' : undefined;
        if (!want) continue;
        for (const c of p.content ?? []) {
          if (c?.type !== want || typeof c.text !== 'string') continue;
          const text = c.text.trim();
          if (!text || (p.role === 'user' && isInjected(text))) continue;
          messages.push({ role: p.role === 'user' ? 'user' : 'agent', text, time: r.timestamp });
        }
      }
      return messages;
    },
  };

  return { name: 'codex', harnesses: [harness] };
}
