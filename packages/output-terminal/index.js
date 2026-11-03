import { formatDateTime, formatTime } from '@wdysa/core';

const RULE = 40;

function paint(color) {
  const wrap = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
  return { user: wrap('1;36'), agent: wrap('1;33'), dim: wrap('2') };
}

const bar = (char, label) => `${char}${char} ${label} ${char.repeat(Math.max(4, RULE - label.length))}`;

export default function terminalPlugin() {
  return {
    name: 'terminal',
    outputs: [
      {
        name: 'terminal',
        render({ session, messages }, { color }) {
          const c = paint(color);
          const head = `Session ${session.id} · ${session.harness} · last record ${formatDateTime(session.updatedAt)}`;
          const lines = [c.dim(head)];
          for (const m of messages) {
            const label = m.role === 'user' ? `User ${formatTime(m.time)}`.trimEnd() : session.label;
            lines.push('', m.role === 'user' ? c.user(bar('━', label)) : c.agent(bar('─', label)), m.text);
          }
          return lines.join('\n');
        },
        renderList(sessions, { color }) {
          const c = paint(color);
          const w = Math.max(...sessions.map((s) => s.harness.length));
          return sessions
            .map((s) => `${s.id}  ${s.harness.padEnd(w)}  ${c.dim(formatDateTime(s.updatedAt, { seconds: false }))}  ${s.title ?? ''}`.trimEnd())
            .join('\n');
        },
      },
    ],
  };
}
