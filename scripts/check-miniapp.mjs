import { access, readFile } from 'node:fs/promises';

const root = 'apps/miniapp';
const required = [
  'app.ts',
  'app.json',
  'app.wxss',
  'project.config.json',
  'tsconfig.json',
  'pages/index/index.ts',
  'pages/index/index.json',
  'pages/index/index.wxml',
  'pages/index/index.wxss',
  'config.ts',
  'services/auth.ts',
];
await Promise.all(required.map((path) => access(`${root}/${path}`)));

const project = JSON.parse(await readFile(`${root}/project.config.json`, 'utf8'));
if (
  project.compileType !== 'miniprogram' ||
  project.appid !== 'touristappid' ||
  project.miniprogramRoot !== './' ||
  !project.setting?.useCompilerPlugins?.includes('typescript')
) {
  throw new Error('Mini Program project config must use miniprogram and the safe tourist AppID.');
}
const ignore = await readFile('.gitignore', 'utf8');
if (!ignore.includes('apps/miniapp/project.private.config.json')) {
  throw new Error('project.private.config.json must remain ignored.');
}
console.log('Mini Program TypeScript structure and safe project config validated.');
