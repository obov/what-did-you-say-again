import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readJsonl, readLines } from '@wdysa/core';

/** Claude Code project folder name: every non-alphanumeric UTF-16 unit becomes '-'. */
export const encodeDir = (dir) => dir.replace(/[^a-zA-Z0-9]/g, '-');

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((c) => c?.type === 'text' && typeof c.text === 'string').map((c) => c.text).join('\n');
}

async function jsonlFiles(dir) {
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  return names.filter((n) => n.endsWith('.jsonl')).map((n) => ({ id: n.slice(0, -6), file: join(dir, n) }));
}

async function titleOf(file) {
  let title;
  for await (const line of readLines(file)) {
    if (!line.includes('"ai-title"')) continue;
    try {
      const r = JSON.parse(line);
      if (r.type === 'ai-title' && r.aiTitle) title = r.aiTitle;
    } catch {}
  }
  return title;
}

async function cwdOf(file) {
  for await (const r of readJsonl(file)) {
    if (typeof r.cwd === 'string') return r.cwd;
  }
  return undefined;
}

/**
 * Options:
 *   root   Claude config dir (default $CLAUDE_CONFIG_DIR or ~/.claude)
 *   label  Speaker label (default "Claude")
 */
export default function claudePlugin(options = {}) {
  const projects = () => join(options.root ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects');

  const toSession = async ({ id, file }, cwd, titles) => {
    const st = await stat(file);
    return { id, cwd, file, updatedAt: st.mtime, title: titles ? await titleOf(file) : undefined };
  };

  const harness = {
    name: 'claude',
    label: options.label ?? 'Claude',

    currentSessionId: () => process.env.CLAUDE_CODE_SESSION_ID,

    async list({ dirs, titles }) {
      const root = projects();
      const out = [];
      const seen = new Set();
      for (const dir of dirs) {
        const folder = join(root, encodeDir(dir));
        if (seen.has(folder)) continue;
        seen.add(folder);
        for (const f of await jsonlFiles(folder)) out.push(await toSession(f, dir, titles));
      }
      return out;
    },

    async find({ idPrefix }) {
      const root = projects();
      let folders;
      try {
        folders = await readdir(root);
      } catch {
        return [];
      }
      const out = [];
      for (const name of folders) {
        for (const f of await jsonlFiles(join(root, name))) {
          if (f.id.startsWith(idPrefix)) out.push(await toSession(f, await cwdOf(f.file), true));
        }
      }
      return out;
    },

    async read(session) {
      const records = [];
      for await (const r of readJsonl(session.file)) {
        if (r.type === 'user' || r.type === 'assistant') records.push(r);
      }
      // Newer logs tag human input with origin.kind; older ones lack origin entirely.
      const tagged = records.some((r) => r.type === 'user' && r.origin);
      const messages = [];
      for (const r of records) {
        const text = textOf(r.message?.content).trim();
        if (!text) continue;
        if (r.type === 'assistant') {
          messages.push({ role: 'agent', text, time: r.timestamp });
        } else if (!r.isMeta && (tagged ? r.origin?.kind === 'human' : !text.startsWith('<'))) {
          messages.push({ role: 'user', text, time: r.timestamp });
        }
      }
      return messages;
    },
  };

  return { name: 'claude', harnesses: [harness] };
}
