import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WdysaError } from './errors.js';

const HARNESS_METHODS = ['list', 'find', 'read'];

/** Normalize a config entry: "spec" | ["spec", options] → { spec, options }. */
function parseEntry(entry) {
  if (typeof entry === 'string') return { spec: entry, options: {} };
  if (Array.isArray(entry) && typeof entry[0] === 'string') {
    const options = entry[1] ?? {};
    if (typeof options !== 'object' || Array.isArray(options)) {
      throw new WdysaError(`Plugin options must be an object: ${entry[0]}`, 2);
    }
    return { spec: entry[0], options };
  }
  throw new WdysaError(`Invalid plugin entry: ${JSON.stringify(entry)}`, 2);
}

const isPath = (spec) => spec.startsWith('.') || spec.startsWith('~') || isAbsolute(spec);

/** Import a plugin module from a path (relative to the config dir) or a package name. */
async function importSpec(spec, configDir) {
  if (isPath(spec)) {
    const file = spec.startsWith('~') ? resolve(homedir(), spec.slice(2)) : resolve(configDir, spec);
    return import(pathToFileURL(file).href);
  }
  // Package: config dir first (npm i --prefix <config dir>), then next to wdysa (global installs).
  for (const base of [resolve(configDir, 'noop.js'), import.meta.url]) {
    let resolved;
    try {
      resolved = createRequire(base).resolve(spec);
    } catch {
      continue;
    }
    return import(pathToFileURL(resolved).href);
  }
  return import(spec);
}

function validate(plugin, id) {
  if (!plugin || typeof plugin !== 'object') throw new WdysaError(`Plugin ${id} did not return an object`, 2);
  for (const h of plugin.harnesses ?? []) {
    if (!h || typeof h.name !== 'string' || !h.name) throw new WdysaError(`Plugin ${id}: harness without a name`, 2);
    for (const m of HARNESS_METHODS) {
      if (typeof h[m] !== 'function') throw new WdysaError(`Plugin ${id}: harness "${h.name}" missing ${m}()`, 2);
    }
  }
  for (const o of plugin.outputs ?? []) {
    if (!o || typeof o.name !== 'string' || !o.name) throw new WdysaError(`Plugin ${id}: output without a name`, 2);
    if (typeof o.render !== 'function') throw new WdysaError(`Plugin ${id}: output "${o.name}" missing render()`, 2);
  }
}

/**
 * Load plugins.
 * defaults: [{ id, module }] built-ins, used unless config.defaults === false.
 * A config entry whose spec equals a built-in id replaces that built-in (to pass options).
 */
export async function loadPlugins(config, defaults = []) {
  const entries = (config.data.plugins ?? []).map(parseEntry);
  const overridden = new Set(entries.map((e) => e.spec));
  const builtins = config.data.defaults === false ? [] : defaults;

  const queue = [
    ...builtins.filter((d) => !overridden.has(d.id)).map((d) => ({ id: d.id, module: d.module, options: {}, builtin: true })),
    ...entries.map((e) => {
      const builtin = defaults.find((d) => d.id === e.spec);
      return { id: e.spec, module: builtin?.module, options: e.options, builtin: Boolean(builtin) };
    }),
  ];

  const plugins = [];
  const harnesses = new Map();
  const outputs = new Map();

  for (const item of queue) {
    let mod = item.module;
    if (!mod) {
      try {
        mod = await importSpec(item.id, config.dir);
      } catch (err) {
        throw new WdysaError(`Failed to load plugin ${item.id}: ${err.message}`, 2);
      }
    }
    const factory = mod.default ?? mod;
    let plugin;
    try {
      plugin = typeof factory === 'function' ? await factory(item.options) : factory;
    } catch (err) {
      throw new WdysaError(`Plugin ${item.id} failed to initialize: ${err.message}`, 2);
    }
    validate(plugin, item.id);
    for (const h of plugin.harnesses ?? []) {
      if (harnesses.has(h.name)) throw new WdysaError(`Duplicate harness name "${h.name}" (${item.id})`, 2);
      harnesses.set(h.name, h);
    }
    for (const o of plugin.outputs ?? []) {
      if (outputs.has(o.name)) throw new WdysaError(`Duplicate output name "${o.name}" (${item.id})`, 2);
      outputs.set(o.name, o);
    }
    plugins.push({
      id: item.id,
      name: plugin.name ?? item.id,
      builtin: item.builtin,
      harnesses: (plugin.harnesses ?? []).map((h) => h.name),
      outputs: (plugin.outputs ?? []).map((o) => o.name),
    });
  }
  return { plugins, harnesses, outputs };
}
