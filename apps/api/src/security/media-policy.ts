/** Metadata gate for the existing Staff media registration route. No file upload is implemented. */
export function safeMediaReference(input: {
  mimeType: string;
  objectKey: string;
  playbackUrl: string | null;
  byteSize: number | null;
}): boolean {
  const extensions: Record<string, string[]> = {
    'video/mp4': ['mp4'],
    'image/jpeg': ['jpg', 'jpeg'],
    'image/png': ['png'],
    'image/webp': ['webp'],
    'audio/mpeg': ['mp3'],
  };
  const allowed = extensions[input.mimeType];
  if (!allowed) return false;
  if (input.byteSize !== null && input.byteSize > 1024 * 1024 * 1024) return false;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9/_-]*\.(mp4|jpg|jpeg|png|webp|mp3)$/.test(input.objectKey))
    return false;
  const suffix = input.objectKey.split('.').at(-1)?.toLowerCase();
  if (!suffix || !allowed.includes(suffix)) return false;
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
