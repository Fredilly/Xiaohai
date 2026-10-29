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

// TEMP ISSUE189 PRETTIER EXACT OUTPUT; revert before review.
const { execFileSync } = await import('node:child_process');
for (const [name, path] of [
  ['DETAIL_TS', 'apps/miniapp/pages/picture-book-detail/picture-book-detail.ts'],
  ['DETAIL_TEST', 'apps/miniapp/pages/picture-book-detail/picture-book-detail.test.ts'],
]) {
  const formatted = execFileSync('pnpm', ['exec', 'prettier', path], { encoding: 'utf8' });
  console.log('ISSUE189_' + name + '_BEGIN');
  console.log(Buffer.from(formatted).toString('base64'));
  console.log('ISSUE189_' + name + '_END');
}
