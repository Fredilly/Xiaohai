import assert from 'node:assert/strict';
import test from 'node:test';
import { checkCommands } from './production-cutover-verify.mjs';

test('operator verifier stops before commands when mode or approvals fail', () => {
  const calls = [];
  const run = (...args) => {
    calls.push(args);
    return 0;
  };
  assert.notDeepEqual(checkCommands({ run, mode: 0o644, flags: [] }), []);
  assert.notDeepEqual(checkCommands({ run, mode: 0o600, flags: ['missing approval'] }), []);
  assert.equal(calls.length, 0);
});

test('operator verifier validates Compose and Caddy without service actions', () => {
  const calls = [];
  const run = (cmd, args) => {
    calls.push([cmd, args]);
    return 0;
  };
  assert.deepEqual(checkCommands({ run, mode: 0o600, flags: [] }), []);
  assert.deepEqual(
    calls.map(([cmd, args]) => [cmd, args[0]]),
    [
      ['docker', 'compose'],
      ['caddy', 'version'],
      ['caddy', 'validate'],
    ],
  );
  assert.ok(calls.every(([, args]) => !args.includes('up') && !args.includes('down')));
});

test('operator verifier never auto-pulls a missing Caddy image', () => {
  const calls = [];
  const run = (cmd, args) => {
    calls.push([cmd, args]);
    if (cmd === 'caddy') return 127;
    if (args[0] === 'image') return 1;
    return 0;
  };
  assert.match(checkCommands({ run, mode: 0o600, flags: [] })[0], /unavailable/);
  assert.equal(
    calls.some(([, args]) => args[0] === 'run'),
    false,
  );
});
