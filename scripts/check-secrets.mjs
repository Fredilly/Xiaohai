import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  encoding: 'utf8',
})
  .trim()
  .split('\n')
  .filter(Boolean);
const forbiddenFiles = tracked.filter(
  (path) =>
    (/(^|\/)\.env($|\.)/.test(path) && !path.endsWith('.example')) ||
    path.endsWith('project.private.config.json') ||
    /\.(pem|key|p12|pfx)$/i.test(path),
);
if (forbiddenFiles.length > 0) {
  throw new Error(`Forbidden secret-bearing files are tracked: ${forbiddenFiles.join(', ')}`);
}

const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /sk-[A-Za-z0-9_-]{20,}/,
  /AKIA[0-9A-Z]{16}/,
];
for (const path of tracked) {
  let content;
  try {
    content = await readFile(path, 'utf8');
  } catch {
    continue;
  }
  if (patterns.some((pattern) => pattern.test(content))) {
    throw new Error(`Potential secret detected in ${path}`);
  }
}
console.log(`Secret policy scan passed (${tracked.length} tracked files).`);
