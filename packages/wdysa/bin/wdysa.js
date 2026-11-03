#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { main } from '@wdysa/core';
import claude from '@wdysa/harness-claude';
import codex from '@wdysa/harness-codex';
import json from '@wdysa/output-json';
import markdown from '@wdysa/output-markdown';
import terminal from '@wdysa/output-terminal';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const defaults = [
  { id: '@wdysa/harness-claude', module: claude },
  { id: '@wdysa/harness-codex', module: codex },
  { id: '@wdysa/output-terminal', module: terminal },
  { id: '@wdysa/output-markdown', module: markdown },
  { id: '@wdysa/output-json', module: json },
];

// Piping into `head` closes stdout early; that is not an error.
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') process.exit(process.exitCode ?? 0);
  throw err;
});

process.exitCode = await main(process.argv.slice(2), { defaults, version });
