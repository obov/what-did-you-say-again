#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { main } from '@obov/wdysa-core';
import claude from '@obov/wdysa-harness-claude';
import codex from '@obov/wdysa-harness-codex';
import json from '@obov/wdysa-output-json';
import markdown from '@obov/wdysa-output-markdown';
import terminal from '@obov/wdysa-output-terminal';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const defaults = [
  { id: '@obov/wdysa-harness-claude', module: claude },
  { id: '@obov/wdysa-harness-codex', module: codex },
  { id: '@obov/wdysa-output-terminal', module: terminal },
  { id: '@obov/wdysa-output-markdown', module: markdown },
  { id: '@obov/wdysa-output-json', module: json },
];

// Piping into `head` closes stdout early; that is not an error.
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') process.exit(process.exitCode ?? 0);
  throw err;
});

process.exitCode = await main(process.argv.slice(2), { defaults, version });
