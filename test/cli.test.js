import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { encodeDir } from '@wdysa/harness-claude';

const here = dirname(fileURLToPath(import.meta.url));
const BIN = join(here, '..', 'packages', 'wdysa', 'bin', 'wdysa.js');

const CLAUDE_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const CLAUDE_B = 'aaaaaaaa-2222-4222-8222-222222222222';
const CODEX_ID = '01a19bff-4dd3-7680-8ea7-86914059ec0a';

let root;
let project;
let env;

const jsonl = (rows) => rows.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n';
const setTime = (file, iso) => utimesSync(file, new Date(iso), new Date(iso));

function writeFile(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

function run(args, { cwd = project, extraEnv = {} } = {}) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, env: { ...env, PWD: cwd, ...extraEnv }, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const user = (text, ts, extra = {}) => ({ type: 'user', timestamp: ts, origin: { kind: 'human' }, cwd: project, message: { role: 'user', content: text }, ...extra });
const agent = (text, ts) => ({ type: 'assistant', timestamp: ts, message: { role: 'assistant', content: [{ type: 'text', text }] } });

before(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'wdysa-test-')));
  project = join(root, 'project');
  mkdirSync(join(project, 'sub', 'deeper'), { recursive: true });

  const claudeDir = join(root, 'claude', 'projects', encodeDir(project));
  writeFile(
    join(claudeDir, `${CLAUDE_A}.jsonl`),
    jsonl([
      { type: 'ai-title', aiTitle: 'Old claude session' },
      user('first question', '2026-11-01T01:00:00Z'),
      agent('first answer', '2026-11-01T01:00:05Z'),
    ]),
  );
  writeFile(
    join(claudeDir, `${CLAUDE_B}.jsonl`),
    jsonl([
      { type: 'ai-title', aiTitle: 'Newer claude session' },
      user('q1', '2026-11-02T01:00:00Z'),
      agent('a1', '2026-11-02T01:00:01Z'),
      user('q2', '2026-11-02T01:01:00Z'),
      agent('a2 part one', '2026-11-02T01:01:01Z'),
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: {} }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', content: 'TOOL OUTPUT' }] } },
      '{not json',
      user('<task-notification>done</task-notification>', '2026-11-02T01:01:30Z', { origin: { kind: 'task-notification' } }),
      user('skill body', '2026-11-02T01:01:31Z', { isMeta: true }),
      agent('a2 part two', '2026-11-02T01:01:40Z'),
      user('q3', '2026-11-02T01:02:00Z'),
      agent('a3', '2026-11-02T01:02:01Z'),
    ]),
  );
  setTime(join(claudeDir, `${CLAUDE_A}.jsonl`), '2026-11-01T01:00:05Z');
  setTime(join(claudeDir, `${CLAUDE_B}.jsonl`), '2026-11-02T01:02:01Z');

  const codexFile = join(root, 'codex', 'sessions', '2026', '11', '02', `rollout-2026-11-02T20-22-42-${CODEX_ID}.jsonl`);
  const item = (role, type, text, ts) => ({ timestamp: ts, type: 'response_item', payload: { type: 'message', role, content: [{ type, text }] } });
  writeFile(
    codexFile,
    jsonl([
      { timestamp: '2026-11-02T00:00:00Z', type: 'session_meta', payload: { id: CODEX_ID, cwd: project, base_instructions: { text: 'x'.repeat(100000) } } },
      item('developer', 'input_text', 'DEV PROMPT', '2026-11-02T00:00:01Z'),
      item('user', 'input_text', '<environment_context>\n<cwd>/x</cwd></environment_context>', '2026-11-02T00:00:02Z'),
      item('user', 'input_text', '# AGENTS.md instructions for /x\nrules', '2026-11-02T00:00:03Z'),
      item('user', 'input_text', 'codex question', '2026-11-02T00:00:04Z'),
      { timestamp: '2026-11-02T00:00:05Z', type: 'response_item', payload: { type: 'reasoning', summary: [] } },
      item('assistant', 'output_text', 'codex answer', '2026-11-02T00:00:06Z'),
    ]),
  );
  writeFile(join(root, 'codex', 'session_index.jsonl'), jsonl([{ id: CODEX_ID, thread_name: 'Codex thread' }]));
  setTime(codexFile, '2026-11-03T00:00:00Z');

  env = {
    PATH: process.env.PATH,
    HOME: root,
    CLAUDE_CONFIG_DIR: join(root, 'claude'),
    CODEX_HOME: join(root, 'codex'),
    WDYSA_CONFIG: join(root, 'config', 'config.json'),
  };
});

after(() => rmSync(root, { recursive: true, force: true }));

test('default: newest session across harnesses (codex), injected input removed', () => {
  const r = run([]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^Session 01a19bff-4dd3-7680-8ea7-86914059ec0a · codex · last record /);
  assert.match(r.out, /━━ User \d\d:\d\d ━+\ncodex question/);
  assert.match(r.out, /── Codex ─+\ncodex answer/);
  for (const hidden of ['DEV PROMPT', 'environment_context', 'AGENTS.md']) assert.doesNotMatch(r.out, new RegExp(hidden));
  assert.doesNotMatch(r.out, /\x1b\[/, 'no color when not a tty');
});

test('claude: human input and text replies only, fragments merged, last N turns', () => {
  const r = run(['claude', '2']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, new RegExp(`Session ${CLAUDE_B} · claude`));
  assert.doesNotMatch(r.out, /q1|a1/);
  assert.match(r.out, /q2\n\n── Claude ─+\na2 part one\n\na2 part two\n/);
  assert.match(r.out, /q3\n\n── Claude ─+\na3/);
  for (const hidden of ['TOOL OUTPUT', 'task-notification', 'skill body']) assert.doesNotMatch(r.out, new RegExp(hidden));
});

test('-p 2 picks the second newest session', () => {
  const r = run(['claude', '-p', '2']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, new RegExp(`Session ${CLAUDE_A}`));
  assert.match(r.out, /first answer/);
});

test('walks up from a subfolder without git', () => {
  const r = run(['claude', '1'], { cwd: join(project, 'sub', 'deeper') });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /q3/);
});

test('walk-up stops at the home folder', () => {
  // sessions live in `project`, home is below it → not reachable
  const r = run(['claude'], { cwd: join(project, 'sub', 'deeper'), extraEnv: { HOME: join(project, 'sub') } });
  assert.equal(r.code, 1);
  assert.match(r.err, /^No session logs: /);
});

test('outside the home folder → searches the home folder', () => {
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'wdysa-outside-')));
  const r = run(['claude', '1'], { cwd: outside, extraEnv: { HOME: project } });
  rmSync(outside, { recursive: true, force: true });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /q3/);
});

test('no sessions → exit 1', () => {
  const empty = mkdtempSync(join(tmpdir(), 'wdysa-empty-'));
  const r = run([], { cwd: empty });
  assert.equal(r.code, 1);
  assert.match(r.err, /^No session logs: /);
});

test('current Claude session is excluded', () => {
  const r = run(['claude'], { extraEnv: { CLAUDE_CODE_SESSION_ID: CLAUDE_B } });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, new RegExp(`Session ${CLAUDE_A}`));
});

test('ls lists sessions with titles', () => {
  const r = run(['ls']);
  assert.equal(r.code, 0, r.err);
  const lines = r.out.trim().split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0], new RegExp(`^${CODEX_ID}  codex .*Codex thread$`));
  assert.match(lines[1], new RegExp(`^${CLAUDE_B}  claude.*Newer claude session$`));
});

test('-s finds a session from any folder; ambiguous prefix → exit 2', () => {
  const r = run(['-s', CODEX_ID.slice(0, 13)], { cwd: root });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /codex answer/);

  const amb = run(['-s', 'aaaaaaaa'], { cwd: root });
  assert.equal(amb.code, 2);
  assert.match(amb.err, /^Multiple sessions match aaaaaaaa:/);

  assert.equal(run(['-s', 'abc']).code, 2);
});

test('json and markdown outputs', () => {
  const j = run(['claude', '1', '-o', 'json']);
  assert.equal(j.code, 0, j.err);
  const data = JSON.parse(j.out);
  assert.equal(data.session.id, CLAUDE_B);
  assert.deepEqual(data.messages.map((m) => [m.role, m.text]), [['user', 'q3'], ['agent', 'a3']]);
  assert.equal(data.session.file, undefined, 'harness-private fields are not exposed');

  const md = run(['claude', '1', '-o', 'markdown']);
  assert.equal(md.code, 0, md.err);
  assert.match(md.out, /^# Session aaaaaaaa-2222/);
  assert.match(md.out, /## User · \d\d:\d\d\n\nq3\n\n## Claude · \d\d:\d\d\n\na3/);
});

test('unknown output / harness / option → exit 2', () => {
  assert.match(run(['-o', 'nope']).err, /^Unknown output: nope/);
  assert.match(run(['nope']).err, /^Unknown harness or command: nope/);
  assert.equal(run(['--nope']).code, 2);
});

test('codex: state DB and thread history DB are used when present', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const sq = join(root, 'codex-sqlite');
  mkdirSync(sq, { recursive: true });
  const state = new DatabaseSync(join(sq, 'state_5.sqlite'));
  state.exec(`CREATE TABLE threads (id TEXT, cwd TEXT, rollout_path TEXT, title TEXT, name TEXT,
    updated_at_ms INTEGER, history_mode TEXT, archived INTEGER)`);
  const add = state.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  add.run('dbdbdbdb-0000-7000-8000-000000000001', project, '/missing.jsonl', 'first msg\nmore', null, Date.parse('2026-11-05T00:00:00Z'), 'paginated', 0);
  add.run('dbdbdbdb-0000-7000-8000-000000000002', project, '/missing2.jsonl', 'archived', 'Archived', Date.parse('2026-11-06T00:00:00Z'), 'paginated', 1);
  state.close();
  const hist = new DatabaseSync(join(sq, 'thread_history_1.sqlite'));
  hist.exec('CREATE TABLE thread_items (thread_id TEXT, rollout_ordinal INTEGER, created_at_ms INTEGER, item_json TEXT, item_type TEXT)');
  const item = hist.prepare('INSERT INTO thread_items VALUES (?, ?, ?, ?, ?)');
  const id = 'dbdbdbdb-0000-7000-8000-000000000001';
  item.run(id, 1, 1, JSON.stringify({ content: [{ type: 'text', text: '# AGENTS.md instructions for /x' }] }), 'userMessage');
  item.run(id, 2, 2, JSON.stringify({ content: [{ type: 'text', text: 'db question' }, { type: 'localImage', path: '/a.png' }] }), 'userMessage');
  item.run(id, 3, 3, JSON.stringify({ command: 'ls' }), 'commandExecution');
  item.run(id, 4, 4, JSON.stringify({ text: 'db answer', phase: 'final_answer' }), 'agentMessage');
  hist.close();

  const extraEnv = { CODEX_SQLITE_HOME: sq };
  const ls = run(['ls', 'codex'], { extraEnv });
  assert.equal(ls.code, 0, ls.err);
  assert.equal(ls.out.trim().split('\n').length, 1, 'archived thread hidden, rollout scan not used');
  assert.match(ls.out.trimEnd(), /^dbdbdbdb-0000-7000-8000-000000000001 {2}codex .*first msg$/);

  const r = run(['codex', '-o', 'json'], { extraEnv });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(JSON.parse(r.out).messages.map((m) => [m.role, m.text]), [['user', 'db question'], ['agent', 'db answer']]);

  assert.match(run(['-s', 'dbdbdbdb-0000'], { extraEnv, cwd: root }).out, /db answer/);
  const current = run(['codex', '-o', 'json'], { extraEnv: { ...extraEnv, CODEX_THREAD_ID: id } });
  assert.equal(current.code, 1, 'current Codex session excluded');
});

test('config: custom harness + output plugin work like built-ins', () => {
  const notes = join(root, 'notes');
  writeFile(
    join(notes, 'note-0001-abcdef.json'),
    JSON.stringify({
      cwd: project,
      updated: '2026-11-04T00:00:00Z',
      title: 'Notes title',
      messages: [
        { role: 'user', text: 'hello notes', time: '2026-11-04T00:00:00Z' },
        { role: 'agent', text: 'hi', time: '2026-11-04T00:00:01Z' },
      ],
    }),
  );
  // Relative plugin path resolves against the config file's folder.
  const cfg = join(root, 'config-notes', 'config.json');
  mkdirSync(join(root, 'config-notes', 'plugins'), { recursive: true });
  copyFileSync(join(here, 'fixtures', 'notes-harness.js'), join(root, 'config-notes', 'plugins', 'notes-harness.js'));
  writeFile(cfg, JSON.stringify({ plugins: [['./plugins/notes-harness.js', { root: notes }], ['@wdysa/harness-claude', { label: 'Opus' }]] }));
  const extraEnv = { WDYSA_CONFIG: cfg };

  const r = run([], { extraEnv });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /· notes ·/);
  assert.match(r.out, /── Notes Bot ─+\nhi/);

  assert.match(run(['ls', 'notes'], { extraEnv }).out, /^note-0001-abcdef {2}notes .*Notes title/);
  assert.equal(run(['notes', '-o', 'plain'], { extraEnv }).out, 'user: hello notes\nagent: hi\n');
  assert.match(run(['-s', 'note-0001'], { extraEnv, cwd: root }).out, /hello notes/);
  assert.match(run(['claude', '1'], { extraEnv }).out, /── Opus ─+/, 'built-in options override');

  const p = run(['plugins'], { extraEnv });
  assert.match(p.out, /notes-harness\.js {2}harness: notes {2}output: plain/);
  assert.match(p.out, /@wdysa\/harness-codex \(built-in\) {2}harness: codex/);
});

test('config: defaults false drops built-ins', () => {
  const cfg = join(root, 'config-nodefaults', 'config.json');
  writeFile(cfg, JSON.stringify({ defaults: false, plugins: ['@wdysa/harness-claude', '@wdysa/output-json'], output: 'json', turns: 1 }));
  const r = run([], { extraEnv: { WDYSA_CONFIG: cfg } });
  assert.equal(r.code, 0, r.err);
  const data = JSON.parse(r.out);
  assert.equal(data.session.harness, 'claude');
  assert.equal(data.messages.length, 2);
  assert.match(run(['codex'], { extraEnv: { WDYSA_CONFIG: cfg } }).err, /Unknown harness or command: codex/);
});

test('bad config and bad plugin → exit 2 with message', () => {
  const cfg = join(root, 'config-bad', 'config.json');
  writeFile(cfg, '{oops');
  const r = run([], { extraEnv: { WDYSA_CONFIG: cfg } });
  assert.equal(r.code, 2);
  assert.match(r.err, /^Invalid config JSON/);

  writeFile(cfg, JSON.stringify({ plugins: ['wdysa-plugin-does-not-exist'] }));
  const p = run([], { extraEnv: { WDYSA_CONFIG: cfg } });
  assert.equal(p.code, 2);
  assert.match(p.err, /^Failed to load plugin wdysa-plugin-does-not-exist/);
});
