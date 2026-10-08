export const MOCK_IMAGE_DISPLAY_SOURCE = '/assets/brand/home-parent-reading.jpg';

export function resolvePictureBookImageSource(
  provider: string,
  playbackUrl: string | null,
): string {
  return provider === 'MOCK' ? MOCK_IMAGE_DISPLAY_SOURCE : playbackUrl || '';
}
