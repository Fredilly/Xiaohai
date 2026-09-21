import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { containsSecret, secretFile } from './secret-policy.mjs';

const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  encoding: 'utf8',
})
  .trim()
  .split('\n')
  .filter(Boolean);
const forbiddenFiles = tracked.filter(secretFile);
if (forbiddenFiles.length > 0) {
  throw new Error(`Forbidden secret-bearing files are tracked: ${forbiddenFiles.join(', ')}`);
}

for (const path of tracked) {
  let content;
  try {
    content = await readFile(path, 'utf8');
  } catch {
    continue;
  }
  if (containsSecret(content)) {
    throw new Error(`Potential secret detected in ${path}`);
  }
}
console.log(`Secret policy scan passed (${tracked.length} tracked files).`);
