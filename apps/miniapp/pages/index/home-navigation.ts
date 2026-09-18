export function resolveHomeTargetUrl(target: string) {
  if (target === 'shop') return '/pages/shop/shop';
  if (target === 'ai' || target === 'story-create') return '/pages/story-create/story-create';
  if (target === 'picture-books') return '/pages/picture-books/picture-books';
  if (target === 'animations') return '/pages/animations/animations';
  return `/pages/feature/feature?key=${encodeURIComponent(target)}`;
}
