import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENV_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export function validateSecretKey(key) {
  if (!key || !ENV_KEY_PATTERN.test(key)) {
    throw new Error('Secret name must match [A-Z][A-Z0-9_]*.');
  }
  return key;
}

function gitSucceeds(root, args) {
  try {
    execFileSync('git', args, { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function assertLocalEnvIgnored(root) {
  if (gitSucceeds(root, ['ls-files', '--error-unmatch', '--', '.env'])) {
    throw new Error('Refusing to write: .env is tracked by Git.');
  }
  if (!gitSucceeds(root, ['check-ignore', '--quiet', '--no-index', '--', '.env'])) {
    throw new Error('Refusing to write: .env is not ignored by Git.');
  }
}

function serializeEnvValue(value) {
  if (!value || /[\r\n\0]/u.test(value)) {
    throw new Error('Secret value must be non-empty and contain no line breaks.');
  }
  return /^[A-Za-z0-9_./:+@=-]+$/u.test(value)
    ? value
    : `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

export function upsertEnvValue(content, key, value) {
  validateSecretKey(key);
  const serialized = serializeEnvValue(value);
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const hadFinalNewline = content.endsWith('\n');
  const lines = content ? content.split(/\r?\n/u) : [];
  if (hadFinalNewline) lines.pop();

  const assignment = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`, 'u');
  let replaced = false;
  const next = [];
  for (const line of lines) {
    if (!assignment.test(line)) {
      next.push(line);
    } else if (!replaced) {
      next.push(`${key}=${serialized}`);
      replaced = true;
    }
  }
  if (!replaced) next.push(`${key}=${serialized}`);
  return `${next.join(newline)}${hadFinalNewline || next.length > 0 ? newline : ''}`;
}

export async function setLocalSecret({ root, key, value }) {
  validateSecretKey(key);
  assertLocalEnvIgnored(root);

  const envPath = path.join(root, '.env');
  const examplePath = path.join(root, '.env.example');
  let content;
  try {
    content = await readFile(envPath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    try {
      content = await readFile(examplePath, 'utf8');
    } catch (exampleError) {
      if (exampleError?.code === 'ENOENT') {
        throw new Error('Cannot create .env because .env.example is missing.');
      }
      throw exampleError;
    }
  }

  const updated = upsertEnvValue(content, key, value);
  const temporaryPath = path.join(root, `.env.tmp-${process.pid}-${randomUUID()}`);
  try {
    await writeFile(temporaryPath, updated, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await rename(temporaryPath, envPath);
    await chmod(envPath, 0o600);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export function readHiddenValue(key, input = process.stdin, output = process.stdout) {
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    throw new Error('A TTY is required for hidden secret input.');
  }

  output.write(`Enter value for ${key}: `);
  return new Promise((resolve, reject) => {
    let value = '';
    const wasRaw = Boolean(input.isRaw);

    const cleanup = () => {
      input.off('data', onData);
      input.setRawMode(wasRaw);
      input.pause();
      output.write('\n');
    };
    const finish = () => {
      cleanup();
      try {
        serializeEnvValue(value);
        resolve(value);
      } catch (error) {
        reject(error);
      }
    };
    const onData = (chunk) => {
      for (const character of String(chunk)) {
        if (character === '\u0003') {
          cleanup();
          reject(new Error('Secret input cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          finish();
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = [...value].slice(0, -1).join('');
        } else if (character >= ' ') {
          value += character;
        }
      }
    };

    input.setEncoding('utf8');
    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
  });
}

function repositoryRoot(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    throw new Error('Run this command inside the Xiaohai Git repository.');
  }
}

export async function runSecretSet({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  input = process.stdin,
  output = process.stdout,
  readValue = readHiddenValue,
} = {}) {
  if (argv.length !== 1) {
    throw new Error('Usage: pnpm secret:set SECRET_NAME');
  }
  const key = validateSecretKey(argv[0]);
  const root = repositoryRoot(cwd);
  assertLocalEnvIgnored(root);
  const value = await readValue(key, input, output);
  await setLocalSecret({ root, key, value });
  output.write(`Saved ${key} to local .env.\n`);
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  runSecretSet().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Unable to save secret.'}\n`);
    process.exitCode = 1;
  });
}
