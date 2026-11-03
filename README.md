# what-did-you-say-again (wdysa)

A CLI that prints the recent conversation from a closed agent session back to your terminal.
Built-in harnesses: Claude Code · Codex CLI. Any other agent harness can be added as a plugin.
Output: human input and agent reply text only (tool calls and results excluded). Output format is a plugin too.

```sh
npm install -g wdysa
```

Requires Node.js 20.12+ (22.13+ recommended for fast Codex lookup). No other dependencies.

## Usage

```sh
wdysa                  # previous session in this folder, last 5 turns (newest across all harnesses)
wdysa 10               # last 10 turns
wdysa claude [N]       # one harness only (claude, codex, or any plugin harness name)
wdysa -p 2             # second previous session
wdysa -s <id> [N]      # specific session by id prefix (8+ chars), from any folder
wdysa -o markdown      # output plugin: terminal (default), markdown, json, or any plugin output
wdysa ls [harness]     # sessions in this folder: id · harness · last time · title
wdysa plugins          # config path, loaded plugins, harnesses, outputs
```

1 turn = 1 human input + the agent's full reply to it (consecutive reply fragments merged into one block).

Folder lookup: starting from the current directory, walk up to the home folder (inclusive) and use the nearest folder that has sessions in any selected harness. When called outside the home folder (e.g. `/tmp`), only the home folder is searched, as if run from there. `-s <id>` ignores folders. Both the symlink-resolved path and `$PWD` are tried (e.g. `/tmp` and `/private/tmp`). No git needed.

When run inside an agent, its current session is skipped (Claude Code: `CLAUDE_CODE_SESSION_ID`, Codex: `CODEX_THREAD_ID`).

Exit codes: `0` ok · `1` no session found · `2` usage, config, or plugin error, or ambiguous `-s` prefix.

## Configuration

Config file: `$WDYSA_CONFIG`, else `${XDG_CONFIG_HOME:-~/.config}/wdysa/config.json`. Every field is optional.

```json
{
  "plugins": [
    "wdysa-plugin-example",
    "./plugins/my-harness.js",
    ["@wdysa/harness-claude", { "label": "Opus" }]
  ],
  "defaults": true,
  "output": "terminal",
  "turns": 5
}
```

| Field | Meaning |
|---|---|
| `plugins` | Extra plugins: package name, path, or `[spec, options]`. Listing a built-in replaces it (to pass options) |
| `defaults` | `false` drops all built-ins; only `plugins` are loaded |
| `output` | Default output plugin name |
| `turns` | Default number of turns |

Plugin resolution:

- Path (`./`, `../`, `/`, `~/`): relative to the config file's folder
- Package name: installed in the config folder (`npm install --prefix ~/.config/wdysa <pkg>`), or installed globally next to `wdysa` (`npm install -g <pkg>`)

## Built-in plugins

| Package | Provides | Options |
|---|---|---|
| `@wdysa/harness-claude` | harness `claude` | `root` (default `$CLAUDE_CONFIG_DIR` or `~/.claude`), `label` |
| `@wdysa/harness-codex` | harness `codex` | `root` (default `$CODEX_HOME` or `~/.codex`), `sqliteHome` (default `$CODEX_SQLITE_HOME` or `root`), `sqlite` (`false` to scan rollout files only), `label` |
| `@wdysa/output-terminal` | output `terminal` | Color on a tty unless `NO_COLOR` or `--no-color` |
| `@wdysa/output-markdown` | output `markdown` | |
| `@wdysa/output-json` | output `json` | |

## Writing a plugin

A plugin is an ES module whose default export is a plugin object, or a function `(options) => plugin` (may be async). `options` comes from the config entry.

```js
export default function myPlugin(options = {}) {
  return {
    name: 'my-plugin',
    harnesses: [/* Harness */],
    outputs: [/* Output */],
  };
}
```

### Harness

Teaches wdysa how to find and read one agent tool's session logs. Once loaded, it works with every command: `wdysa <name>`, default selection, `-p`, `-s`, `ls`, and every output.

```js
{
  name: 'mytool',             // CLI name: wdysa mytool. Must be unique
  label: 'MyTool',            // speaker label for replies (default: name)

  // Sessions whose cwd is one of `dirs` (cwd and its parents, absolute paths).
  // titles: true when the caller (ls) wants titles.
  async list({ dirs, titles }) { return [Session] },

  // Sessions whose id starts with idPrefix, from any folder.
  async find({ idPrefix }) { return [Session] },

  // Messages of one session, oldest first. Return only human input and agent text;
  // drop tool calls, tool results, and auto-injected context here.
  async read(session) { return [{ role: 'user' | 'agent', text, time }] },

  // Optional: id of the session currently running this command, to skip it.
  currentSessionId() { return process.env.MYTOOL_SESSION_ID },
}
```

`Session` = `{ id, cwd, updatedAt, title? }` plus any private fields you need in `read()` (e.g. `file`). Private fields are not passed to outputs. `updatedAt` and `time` accept a `Date`, ISO string, or epoch ms.

Helpers from `@wdysa/core`: `readJsonl(file)` (async iterator, skips malformed lines), `readLines(file)`, `readFirstLine(file)`, `formatDateTime(date)`, `formatTime(date)`.

### Output

```js
{
  name: 'html',                                   // CLI name: wdysa -o html. Must be unique
  render({ session, messages }, { color }) { return string },
  renderList(sessions, { color }) { return string }, // optional, used by ls
}
```

`session` = `{ id, harness, label, cwd, updatedAt, title }`. `messages` = `[{ role: 'user' | 'agent', text, time }]`, already merged and cut to the requested turns.

A full example harness + output: [`test/fixtures/notes-harness.js`](test/fixtures/notes-harness.js).

## Log formats (built-in harnesses)

| | Claude Code | Codex CLI |
|---|---|---|
| Root | `${CLAUDE_CONFIG_DIR:-~/.claude}/projects` | `${CODEX_HOME:-~/.codex}/sessions` |
| File | `<encoded cwd>/<session-id>.jsonl` | `YYYY/MM/DD/rollout-<time>-<session-id>.jsonl` (rollout file) |
| Session list | folder name = cwd with every non-alphanumeric char replaced by `-` | `threads` table of `state_5.sqlite` (`cwd`, `name`/`title`, `rollout_path`, not `archived`). Fallback: first line `session_meta.payload.cwd` of every rollout file (slow) |
| Title | `aiTitle` of `type=="ai-title"` | `threads.name`, else first line of `threads.title`. Fallback: `thread_name` in `session_index.jsonl` |
| Human input | `type=="user"`, `origin.kind=="human"`, not `isMeta` (older logs without `origin`: text not starting with `<`) | `userMessage` text items in `thread_history_1.sqlite` `thread_items` (paginated threads), else rollout `payload.role=="user"` `input_text`. Both exclude text starting with `<` or `# AGENTS.md instructions` |
| Agent reply | `type=="assistant"` `text` items | `agentMessage` items, else rollout `payload.role=="assistant"` `output_text` |

Codex SQLite DBs live in `$CODEX_SQLITE_HOME`, else `$CODEX_HOME` (the `sqlite_home` key in Codex's `config.toml` is not read; use the `sqliteHome` option). They are opened read-only via `node:sqlite` (Node 22.13+). On older Node, or when a DB is missing or its schema changed, the harness falls back to rollout files. Source: `codex-rs/state/src/sqlite.rs` in [openai/codex](https://github.com/openai/codex).

## Repository layout

```text
packages/
  wdysa/            CLI (bin) that wires the built-in plugins
  core/             @wdysa/core: config, plugin loader, folder lookup, turn slicing, CLI
  harness-claude/   @wdysa/harness-claude
  harness-codex/    @wdysa/harness-codex
  output-terminal/  @wdysa/output-terminal
  output-markdown/  @wdysa/output-markdown
  output-json/      @wdysa/output-json
test/               node:test suite with fixture logs and an example plugin
```

```sh
npm install
npm test
```

Publishing: every package must be published (`@wdysa/*` first, then `wdysa`):

```sh
npm publish --workspaces --access public
```

## Open questions

```text
Q3. Codex can compress cold rollout files to .jsonl.zst (feature local_thread_store_compression, off by default).
    Not read yet; matters only for the rollout-file fallback
Q4. Whether an option is needed to show tool calls as one-line summaries (e.g. "· Bash: npm run check")
```
