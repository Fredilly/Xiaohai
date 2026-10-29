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
