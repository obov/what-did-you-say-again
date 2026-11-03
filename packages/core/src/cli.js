import { loadConfig } from './config.js';
import { pickHarnesses, publicSession, sessionsById, sessionsHere, transcript } from './engine.js';
import { WdysaError } from './errors.js';
import { loadPlugins } from './plugins.js';
import { formatDateTime } from './time.js';

const HELP = `Usage: wdysa [harness] [N] [options]
       wdysa ls [harness]
       wdysa plugins

Print the last N turns (default 5) of the previous agent session in this folder.
The nearest folder with sessions is used, walking up from the current directory
to the home folder. Outside the home folder, the home folder is searched instead.

Arguments:
  harness            Only this harness (e.g. claude, codex, or any plugin harness)
  N                  Number of turns

Options:
  -p, --previous K   K-th previous session (default 1)
  -s, --session ID   Specific session by id prefix (8+ chars), from any folder
  -o, --output NAME  Output plugin (e.g. terminal, markdown, json)
      --no-color     Disable color
  -h, --help         Show this help
  -V, --version      Show version

Commands:
  ls                 List sessions in this folder: id · harness · last time · title
  plugins            Show config path, loaded plugins, harnesses and outputs`;

function intArg(value, flag) {
  if (!/^\d+$/.test(value ?? '') || Number(value) < 1) throw new WdysaError(`${flag} needs a positive integer`, 2);
  return Number(value);
}

export function parseArgs(argv) {
  const args = { positionals: [], previous: 1, color: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new WdysaError(`${a} needs a value`, 2);
      return argv[++i];
    };
    if (a === '-h' || a === '--help') args.help = true;
    else if (a === '-V' || a === '--version') args.version = true;
    else if (a === '-p' || a === '--previous') args.previous = intArg(next(), a);
    else if (a === '-s' || a === '--session') args.session = next();
    else if (a === '-o' || a === '--output') args.output = next();
    else if (a === '--no-color') args.color = false;
    else if (a === '--color') args.color = true;
    else if (a.startsWith('-') && a !== '-') throw new WdysaError(`Unknown option: ${a}`, 2);
    else args.positionals.push(a);
  }
  return args;
}

/**
 * Run the CLI.
 * defaults: built-in plugins [{ id, module }]. io: { stdout, stderr, env, cwd } for tests.
 * Returns the exit code.
 */
export async function main(argv, { defaults = [], version = '', io = {} } = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const env = io.env ?? process.env;
  const cwd = io.cwd ?? process.cwd();
  const write = (stream, text) => stream.write(text.endsWith('\n') ? text : `${text}\n`);

  try {
    const args = parseArgs(argv);
    if (args.help) return write(stdout, HELP), 0;
    if (args.version) return write(stdout, version), 0;

    const config = await loadConfig(env);
    const { plugins, harnesses, outputs } = await loadPlugins(config, defaults);

    const color = args.color ?? (Boolean(stdout.isTTY) && !env.NO_COLOR);
    const outputName = args.output ?? config.data.output ?? 'terminal';
    const output = outputs.get(outputName);
    const ctx = { color, env, cwd };

    let command;
    let harnessName;
    let turns = Number.isInteger(config.data.turns) && config.data.turns > 0 ? config.data.turns : 5;
    for (const p of args.positionals) {
      if (/^\d+$/.test(p)) turns = intArg(p, 'N');
      else if (!command && !harnessName && (p === 'ls' || p === 'plugins')) command = p;
      else if (!harnessName && harnesses.has(p)) harnessName = p;
      else throw new WdysaError(`Unknown harness or command: ${p}\nHarnesses: ${[...harnesses.keys()].join(', ') || '(none)'}`, 2);
    }

    if (command === 'plugins') {
      const lines = [`Config: ${config.path}${config.exists ? '' : ' (not found, using defaults)'}`, ''];
      for (const p of plugins) {
        const parts = [p.harnesses.length && `harness: ${p.harnesses.join(', ')}`, p.outputs.length && `output: ${p.outputs.join(', ')}`].filter(Boolean);
        lines.push(`${p.id}${p.builtin ? ' (built-in)' : ''}  ${parts.join('  ')}`);
      }
      return write(stdout, lines.join('\n')), 0;
    }

    if (!output) {
      throw new WdysaError(`Unknown output: ${outputName}\nOutputs: ${[...outputs.keys()].join(', ') || '(none)'}`, 2);
    }
    const selected = pickHarnesses(harnesses, harnessName);
    if (selected.length === 0) throw new WdysaError('No harness plugins loaded. Check `wdysa plugins`.', 2);

    if (command === 'ls') {
      const found = await sessionsHere(selected, { cwd, env, titles: true });
      if (found.sessions.length === 0) throw noSessions(found, cwd);
      const { sessions } = found;
      const list = sessions.map(publicSession);
      const text = output.renderList ? await output.renderList(list, ctx) : defaultList(list);
      return write(stdout, text), 0;
    }

    let session;
    if (args.session) {
      if (args.session.length < 8) throw new WdysaError('Session id prefix needs at least 8 characters', 2);
      const matches = await sessionsById(selected, args.session);
      if (matches.length === 0) throw new WdysaError(`No session matches: ${args.session}`, 1);
      if (matches.length > 1) {
        throw new WdysaError(`Multiple sessions match ${args.session}:\n${defaultList(matches.map(publicSession), true)}`, 2);
      }
      session = matches[0];
    } else {
      const { sessions, ...scope } = await sessionsHere(selected, { cwd, env });
      if (sessions.length === 0) throw noSessions(scope, cwd);
      session = sessions[args.previous - 1];
      if (!session) throw new WdysaError(`No previous session #${args.previous} (found ${sessions.length})`, 1);
    }

    const harness = harnesses.get(session.harness);
    const t = await transcript(harness, session, turns);
    const text = await output.render({ session: publicSession(t.session), messages: t.messages }, ctx);
    return write(stdout, text), 0;
  } catch (err) {
    if (err instanceof WdysaError) {
      write(stderr, err.message);
      return err.exitCode;
    }
    write(stderr, err?.stack ?? String(err));
    return 1;
  }
}

function noSessions({ outsideHome, home }, cwd) {
  return new WdysaError(outsideHome ? `No session logs: ${home} (outside home folder, searched home instead of ${cwd})` : `No session logs: ${cwd}`, 1);
}

function defaultList(sessions, withCwd = false) {
  return sessions
    .map((s) => [s.id, s.harness, formatDateTime(s.updatedAt, { seconds: false }), withCwd ? s.cwd : s.title ?? ''].join('  ').trimEnd())
    .join('\n');
}
