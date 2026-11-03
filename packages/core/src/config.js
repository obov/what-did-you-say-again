import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { WdysaError } from './errors.js';

export function configPath(env = process.env) {
  if (env.WDYSA_CONFIG) return env.WDYSA_CONFIG;
  const base = env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'wdysa', 'config.json');
}

/**
 * Config file shape (all fields optional):
 * {
 *   "plugins": ["pkg-name", "./local-plugin.js", ["pkg-name", { ...options }]],
 *   "defaults": true,      // load built-in plugins (claude, codex, terminal, markdown, json)
 *   "output": "terminal",  // default output plugin name
 *   "turns": 5             // default number of turns
 * }
 */
export async function loadConfig(env = process.env) {
  const path = configPath(env);
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return { path, dir: dirname(path), exists: false, data: {} };
    throw err;
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new WdysaError(`Invalid config JSON: ${path}: ${err.message}`, 2);
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new WdysaError(`Config must be a JSON object: ${path}`, 2);
  }
  if (data.plugins !== undefined && !Array.isArray(data.plugins)) {
    throw new WdysaError(`Config "plugins" must be an array: ${path}`, 2);
  }
  return { path, dir: dirname(path), exists: true, data };
}
