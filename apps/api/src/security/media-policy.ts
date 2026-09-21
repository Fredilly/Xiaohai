/** Metadata gate for the existing Staff media registration route. No file upload is implemented. */
export function safeMediaReference(input: {
  mimeType: string;
  objectKey: string;
  playbackUrl: string | null;
  byteSize: number | null;
}): boolean {
  if (
    !['video/mp4', 'image/jpeg', 'image/png', 'image/webp', 'audio/mpeg'].includes(input.mimeType)
  )
    return false;
  if (input.byteSize !== null && input.byteSize > 1024 * 1024 * 1024) return false;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9/_-]*\.(mp4|jpg|jpeg|png|webp|mp3)$/.test(input.objectKey))
    return false;
  if (input.objectKey.split('/').some((part) => part === '..' || part === '.')) return false;
  if (input.playbackUrl) {
    try {
      const url = new URL(input.playbackUrl);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
        return false;
    } catch {
      return false;
    }
  }
  return true;
}
