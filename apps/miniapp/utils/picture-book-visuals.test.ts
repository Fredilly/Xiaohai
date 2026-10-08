import { describe, expect, it } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { MOCK_IMAGE_DISPLAY_SOURCE, resolvePictureBookImageSource } from './picture-book-visuals';

describe('picture book image display source', () => {
  it('uses the bundled asset for MOCK READY images and never the playback URL', () => {
    expect(resolvePictureBookImageSource('MOCK', 'http://127.0.0.1:3000/mock.jpg')).toBe(
      MOCK_IMAGE_DISPLAY_SOURCE,
    );
  });

  it('ships the bundled display asset in the Mini Program project', () => {
    const asset = resolve(process.cwd(), MOCK_IMAGE_DISPLAY_SOURCE.slice(1));
    expect(existsSync(asset)).toBe(true);
    expect(statSync(asset).size).toBeGreaterThan(0);
  });
});
