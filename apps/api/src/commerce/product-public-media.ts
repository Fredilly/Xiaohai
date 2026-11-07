/**
 * Product gallery images are served on an unauthenticated catalog endpoint.
 * Treat product_media as public merchant artwork only, never signed private BOS
 * playback URLs or loopback/internal resources. Source uploads require a
 * separately reviewed staff-only authorization and ownership flow.
 */
export function publicProductGalleryUrls(values: readonly string[]): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const value = raw.trim();
    if (!value || value.length > 2048) continue;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) continue;
    if (url.search || url.hash || !url.pathname || url.pathname === '/') continue;
    const host = url.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.invalid') ||
      host === '::1' ||
      host === '[::1]' ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) {
      continue;
    }
    if (seen.has(value)) continue;
    seen.add(value);
    urls.push(value);
    if (urls.length >= 8) break;
  }
  return urls;
}
