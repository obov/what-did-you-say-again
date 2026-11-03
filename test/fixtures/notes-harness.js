// Example third-party harness: one JSON file per session in options.root.
// { "cwd": "/path", "updated": "ISO", "title": "...", "messages": [{ "role": "user" | "agent", "text": "...", "time": "ISO" }] }
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export default function notes(options = {}) {
  const all = async () =>
    Promise.all(
      (await readdir(options.root)).map(async (name) => {
        const data = JSON.parse(await readFile(join(options.root, name), 'utf8'));
        return { id: name.replace(/\.json$/, ''), cwd: data.cwd, updatedAt: data.updated, title: data.title, data };
      }),
    );
  return {
    name: 'notes',
    harnesses: [
      {
        name: 'notes',
        label: 'Notes Bot',
        list: async ({ dirs }) => (await all()).filter((s) => dirs.includes(s.cwd)),
        find: async ({ idPrefix }) => (await all()).filter((s) => s.id.startsWith(idPrefix)),
        read: async (s) => s.data.messages,
      },
    ],
    outputs: [{ name: 'plain', render: ({ messages }) => messages.map((m) => `${m.role}: ${m.text}`).join('\n') }],
  };
}
