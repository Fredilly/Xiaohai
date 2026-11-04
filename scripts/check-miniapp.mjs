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
const miniappConfig = await readFile(`${root}/config.ts`, 'utf8');
for (const environment of ['dev', 'staging', 'production']) {
  if (!miniappConfig.includes(`${environment}:`)) {
    throw new Error(`Mini Program API configuration must define ${environment}.`);
  }
}
if (
  !miniappConfig.includes("dev: 'https://staging-api.pamboo.asia'") ||
  !miniappConfig.includes("staging: 'https://staging-api.pamboo.asia'") ||
  !miniappConfig.includes("production: 'https://api.example.invalid'")
) {
  throw new Error('Mini Program API endpoints must keep safe environment-specific defaults.');
}
if (
  /\bdev:\s*['"]http:\/\//.test(miniappConfig) ||
  /\bdev:\s*['"]https?:\/\/(?:127\.0\.0\.1|localhost)/.test(miniappConfig)
) {
  throw new Error('Develop Mini Program API must not resolve to loopback or insecure HTTP.');
}
const ignore = await readFile('.gitignore', 'utf8');
if (!ignore.includes('apps/miniapp/project.private.config.json')) {
  throw new Error('project.private.config.json must remain ignored.');
}
// A BOS URL alone is insufficient: migrated editorial images must stay out of the bundle.
for (const removedAsset of [
  'assets/brand/home-parent-reading.jpg',
  'assets/books/book-dinosaurs-need-a-big-hand.jpg',
  'assets/books/book-pew-pew-tiger.jpg',
  'assets/books/book-dodos-hairy-day.jpg',
  'assets/books/book-yuns-diary.jpg',
]) {
  try {
    await access(`${root}/${removedAsset}`);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      continue;
    }
    throw error;
  }
  throw new Error(`BOS-migrated asset must not be bundled: ${removedAsset}`);
}
const assetManifest = await readFile(`${root}/src/config/assets.ts`, 'utf8');
const runtimeVisuals = await readFile(`${root}/utils/real-visuals.ts`, 'utf8');
const [homeTemplate, homeStyles, shopTemplate, globalStyles, productTemplate, productStyles] =
  await Promise.all([
    readFile(`${root}/pages/index/index.wxml`, 'utf8'),
    readFile(`${root}/pages/index/index.wxss`, 'utf8'),
    readFile(`${root}/pages/shop/shop.wxml`, 'utf8'),
    readFile(`${root}/app.wxss`, 'utf8'),
    readFile(`${root}/pages/product/product.wxml`, 'utf8'),
    readFile(`${root}/pages/product/product.wxss`, 'utf8'),
  ]);

if (!assetManifest.includes("BOS_ASSET_ORIGIN = 'https://xiaohai-prod-assets.cd.bcebos.com'")) {
  throw new Error('Mini Program BOS assets must use the approved HTTPS origin.');
}

for (const objectPath of [
  'home/hero/parent-child-reading-v2.jpg',
  'books/covers/dinosaurs-need-a-big-hand-v2.png',
  'books/covers/pew-pew-tiger-v2.jpg',
  'books/covers/dodos-hairy-day-v2.jpg',
  'books/covers/yuns-diary-v2.png',
]) {
  if (!assetManifest.includes(objectPath)) {
    throw new Error(`Mini Program BOS asset manifest is missing ${objectPath}.`);
  }
}

if (/\/assets\/(?:brand\/home-parent-reading|books\/book-)/.test(runtimeVisuals)) {
  throw new Error('Large editorial images must not fall back to bundled Mini Program assets.');
}

for (const [name, template, handler] of [
  ['home hero', homeTemplate, 'binderror="mediaError"'],
  ['shop cover', shopTemplate, 'binderror="coverError"'],
  ['product cover', productTemplate, 'binderror="coverError"'],
]) {
  if (!template.includes(handler)) {
    throw new Error(`${name} must keep an image-load failure fallback.`);
  }
}

for (const [name, styles, fixedSizePattern] of [
  ['home hero', homeStyles, /\.hero-media\s*{[^}]*height:\s*260rpx/s],
  ['shop cover', globalStyles, /\.book-cover\s*{[^}]*width:\s*112rpx[^}]*height:\s*150rpx/s],
  ['product cover', productStyles, /\.product-cover\s*{[^}]*height:\s*390rpx/s],
]) {
  if (!fixedSizePattern.test(styles)) {
    throw new Error(`${name} must reserve image space to avoid remote-load layout shifts.`);
  }
}
console.log('Mini Program TypeScript structure and safe project config validated.');
