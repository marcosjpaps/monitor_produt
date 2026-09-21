#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run('node', ['scripts/context/extract.mjs']);
run('node', ['scripts/context/validate.mjs']);

console.log('Context build complete.');
