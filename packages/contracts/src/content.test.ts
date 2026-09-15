import { describe, expect, it } from 'vitest';
import { episodeInputSchema, progressUpdateSchema } from './content.js';
describe('M7 content contracts', () => {
  it('requires a preview boundary for PREVIEW episodes', () => { expect(episodeInputSchema.safeParse({ seriesId: crypto.randomUUID(), mediaAssetId: null, episodeNumber: 1, title: 'Preview', description: null, accessMode: 'PREVIEW', previewSeconds: null, status: 'PUBLISHED' }).success).toBe(false); });
  it('rejects negative playback progress', () => { expect(progressUpdateSchema.safeParse({ positionSeconds: -1, completed: false }).success).toBe(false); });
});
