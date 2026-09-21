#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const hooksDir = path.join(root, '.githooks');
const preCommit = path.join(hooksDir, 'pre-commit');

fs.mkdirSync(hooksDir, { recursive: true });
fs.writeFileSync(
  preCommit,
  '#!/usr/bin/env sh\n' +
    'npm run context:check\n',
  'utf8',
);
fs.chmodSync(preCommit, 0o755);

const gitConfig = spawnSync('git', ['config', 'core.hooksPath', '.githooks'], {
  cwd: root,
  stdio: 'inherit',
});

if (gitConfig.status !== 0) {
  process.exit(gitConfig.status ?? 1);
}

console.log('Installed Git hook at .githooks/pre-commit');
console.log('Git config updated: core.hooksPath=.githooks');
