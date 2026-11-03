const iso = (d) => (d instanceof Date ? d.toISOString() : d ?? null);
const session = (s) => ({ ...s, updatedAt: iso(s.updatedAt), title: s.title ?? null });

export default function jsonPlugin() {
  return {
    name: 'json',
    outputs: [
      {
        name: 'json',
        render(t) {
          return JSON.stringify(
            { session: session(t.session), messages: t.messages.map((m) => ({ ...m, time: iso(m.time) })) },
            null,
            2,
          );
        },
        renderList(sessions) {
          return JSON.stringify(sessions.map(session), null, 2);
        },
      },
    ],
  };
}
