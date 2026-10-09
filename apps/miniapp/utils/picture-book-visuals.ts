export const MOCK_IMAGE_DISPLAY_SOURCE = '/assets/brand/xiaohai-logo.png';

export function resolvePictureBookImageSource(
  provider: string,
  playbackUrl: string | null,
): string {
  return provider === 'MOCK' ? MOCK_IMAGE_DISPLAY_SOURCE : playbackUrl || '';
}
