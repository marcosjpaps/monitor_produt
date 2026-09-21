#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'pipe', encoding: 'utf8', ...options });
  return result;
}

const build = run('node', ['scripts/context/build.mjs'], { stdio: 'inherit' });
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const addGenerated = run('git', [
  'add',
  '--',
  'context/generated',
  'context/links/graph.json',
  'context/manifest.json',
]);

if (addGenerated.status !== 0) {
  console.error(addGenerated.stderr || 'Failed to stage generated context artifacts.');
  process.exit(1);
}

const diffUnstaged = run('git', [
  'diff',
  '--name-only',
  '--',
  'context/generated',
  'context/links/graph.json',
  'context/manifest.json',
]);

if (diffUnstaged.status !== 0) {
  console.error(diffUnstaged.stderr || 'Failed to run git diff for context check.');
  process.exit(1);
}

const untracked = run('git', [
  'ls-files',
  '--others',
  '--exclude-standard',
  '--',
  'context/generated',
  'context/links/graph.json',
  'context/manifest.json',
]);

if (untracked.status !== 0) {
  console.error(untracked.stderr || 'Failed to run git ls-files for context check.');
  process.exit(1);
}

const changed = `${diffUnstaged.stdout}\n${untracked.stdout}`
  .split('\n')
  .map((v) => v.trim())
  .filter(Boolean);

if (changed.length > 0) {
  console.error('Context artifacts are stale. Regenerate and commit these files:');
  for (const file of changed) {
    console.error(`- ${file}`);
  }
  console.error('Run: npm run context:build');
  process.exit(1);
}

console.log('Context freshness check passed.');
