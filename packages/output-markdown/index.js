import { formatDateTime, formatTime } from '@obov/wdysa-core';

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

export default function markdownPlugin() {
  return {
    name: 'markdown',
    outputs: [
      {
        name: 'markdown',
        render({ session, messages }) {
          const out = [
            `# ${session.title ?? `Session ${session.id}`}`,
            '',
            `\`${session.id}\` · ${session.harness} · last record ${formatDateTime(session.updatedAt)}`,
          ];
          for (const m of messages) {
            const who = m.role === 'user' ? 'User' : session.label;
            const time = formatTime(m.time);
            out.push('', `## ${who}${time ? ` · ${time}` : ''}`, '', m.text);
          }
          return out.join('\n');
        },
        renderList(sessions) {
          return [
            '| id | harness | last record | title |',
            '|---|---|---|---|',
            ...sessions.map((s) => `| \`${s.id}\` | ${s.harness} | ${formatDateTime(s.updatedAt, { seconds: false })} | ${cell(s.title)} |`),
          ].join('\n');
        },
      },
    ],
  };
}
