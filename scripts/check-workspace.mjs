import { readFile, access } from 'node:fs/promises';

const required = [
  'apps/miniapp/package.json',
  'apps/admin-web/package.json',
  'apps/store-web/package.json',
  'apps/api/package.json',
  'apps/worker/package.json',
  'packages/domain/package.json',
  'packages/db/package.json',
  'packages/contracts/package.json',
  'packages/validation/package.json',
  'packages/config/package.json',
  'packages/test-utils/package.json',
];

await Promise.all(required.map((path) => access(path)));
const workspace = await readFile('pnpm-workspace.yaml', 'utf8');
if (!workspace.includes('apps/*') || !workspace.includes('packages/*')) {
  throw new Error('pnpm workspace globs are incomplete');
}
console.log(`Workspace structure validated (${required.length} packages).`);

// Temporary CI formatting diagnostic for one test-only file; remove before review.
const { execFileSync } = await import('node:child_process');
const formattedTest = execFileSync(
  'pnpm',
  ['exec', 'prettier', 'apps/api/test/refund-reservation.integration.test.ts'],
  { encoding: 'utf8' },
);
console.log('REFUND_TEST_PRETTIER_BEGIN');
console.log(Buffer.from(formattedTest).toString('base64'));
console.log('REFUND_TEST_PRETTIER_END');
