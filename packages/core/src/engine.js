import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve, sep } from 'node:path';
import { WdysaError } from './errors.js';
import { toDate } from './time.js';

/** Path plus its symlink-resolved form. */
function forms(path) {
  const out = new Set([resolve(path)]);
  try {
    out.add(realpathSync(path));
  } catch {}
  return [...out];
}

const within = (dir, root) => dir === root || dir.startsWith(root.endsWith(sep) ? root : root + sep);

/**
 * Folders to search → distance from cwd.
 * Inside the home folder: cwd and its parents up to home (inclusive).
 * Outside the home folder: the home folder only, as if run from there.
 * Both symlink-resolved and logical ($PWD) paths are tried.
 */
export function ancestors(cwd = process.cwd(), env = process.env) {
  const homes = forms(env.HOME || homedir());
  const starts = forms(cwd);
  if (env.PWD) {
    try {
      if (realpathSync(env.PWD) === realpathSync(cwd)) starts.push(resolve(env.PWD));
    } catch {}
  }
  const distance = new Map();
  for (const start of starts) {
    const home = homes.find((h) => within(start, h));
    if (!home) continue;
    let dir = start;
    for (let d = 0; ; d++) {
      if (!distance.has(dir) || distance.get(dir) > d) distance.set(dir, d);
      if (dir === home) break;
      dir = dirname(dir);
    }
  }
  if (distance.size === 0) for (const h of homes) distance.set(h, 0);
  distance.outsideHome = !starts.some((st) => homes.some((h) => within(st, h)));
  distance.home = homes[0];
  return distance;
}

function normalize(harness, s) {
  return {
    ...s,
    id: String(s.id),
    harness: harness.name,
    label: harness.label ?? harness.name,
    updatedAt: toDate(s.updatedAt),
  };
}

function withoutCurrent(harness, sessions) {
  const current = harness.currentSessionId?.();
  return current ? sessions.filter((s) => s.id !== current) : sessions;
}

const byRecent = (a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0);

/** Sessions in the nearest folder (cwd or a parent) that has any, newest first. */
export async function sessionsHere(harnesses, { cwd, env, titles = false } = {}) {
  const distance = ancestors(cwd, env);
  const dirs = [...distance.keys()];
  const all = [];
  for (const h of harnesses) {
    const found = (await h.list({ dirs, titles })) ?? [];
    all.push(...withoutCurrent(h, found.map((s) => normalize(h, s))));
  }
  const near = all.filter((s) => distance.has(s.cwd));
  const scope = { outsideHome: distance.outsideHome, home: distance.home };
  if (near.length === 0) return { dir: undefined, sessions: [], ...scope };
  const best = Math.min(...near.map((s) => distance.get(s.cwd)));
  const sessions = near.filter((s) => distance.get(s.cwd) === best).sort(byRecent);
  return { dir: sessions[0].cwd, sessions, ...scope };
}

/** Sessions whose id starts with prefix, across all folders. */
export async function sessionsById(harnesses, prefix) {
  const all = [];
  for (const h of harnesses) {
    const found = (await h.find({ idPrefix: prefix })) ?? [];
    all.push(...found.map((s) => normalize(h, s)).filter((s) => s.id.startsWith(prefix)));
  }
  return all.sort(byRecent);
}

/**
 * Raw messages → merged messages limited to the last `turns` turns.
 * 1 turn = 1 user message + every agent message after it (consecutive agent messages are merged).
 */
export function lastTurns(messages, turns) {
  const merged = [];
  for (const m of messages) {
    const text = String(m.text ?? '').trim();
    if (!text) continue;
    const role = m.role === 'user' ? 'user' : 'agent';
    const prev = merged.at(-1);
    if (prev && role === 'agent' && prev.role === 'agent') {
      prev.text += `\n\n${text}`;
      prev.time = toDate(m.time) ?? prev.time;
    } else {
      merged.push({ role, text, time: toDate(m.time) });
    }
  }
  const userIdx = merged.flatMap((m, i) => (m.role === 'user' ? [i] : []));
  if (userIdx.length > turns) return merged.slice(userIdx[userIdx.length - turns]);
  return merged;
}

export async function transcript(harness, session, turns) {
  const messages = (await harness.read(session)) ?? [];
  return { session, messages: lastTurns(messages, turns) };
}

/** Session fields safe to hand to output plugins (drops harness-private fields). */
export function publicSession(s) {
  return { id: s.id, harness: s.harness, label: s.label, cwd: s.cwd, updatedAt: s.updatedAt, title: s.title };
}

export function pickHarnesses(all, name) {
  if (!name) return [...all.values()];
  const h = all.get(name);
  if (!h) throw new WdysaError(`Unknown harness: ${name}`, 2);
  return [h];
}
