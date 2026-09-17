import { createHash } from 'node:crypto';

export type CompositionSceneInput = {
  sceneGenerationId: string;
  sceneOrder: number;
  playbackUrl: string;
  mimeType: string;
  durationSeconds: number | null;
};
export type CompositionInput = {
  compositionId: string;
  scenes: CompositionSceneInput[];
  signal: AbortSignal;
};
export type CompositionResult = {
  storageProvider: string;
  objectKey: string;
  playbackUrl: string;
  mimeType: 'video/mp4';
  byteSize: number | null;
  durationSeconds: number;
  providerRequestId: string;
};
export interface CompositionProvider {
  readonly name: 'MOCK';
  compose(input: CompositionInput): Promise<CompositionResult>;
}
export class CompositionProviderError extends Error {
  constructor(
    readonly code:
      | 'COMPOSITION_PROVIDER_UNAVAILABLE'
      | 'COMPOSITION_PROVIDER_TIMEOUT'
      | 'COMPOSITION_PROVIDER_INVALID_OUTPUT',
  ) {
    super(code);
  }
}
export class MockCompositionProvider implements CompositionProvider {
  readonly name = 'MOCK' as const;
  compose(input: CompositionInput): Promise<CompositionResult> {
    if (input.signal.aborted)
      return Promise.reject(new CompositionProviderError('COMPOSITION_PROVIDER_TIMEOUT'));
    if (
      !input.scenes.length ||
      input.scenes.some((scene) => !scene.playbackUrl || scene.playbackUrl.startsWith('data:'))
    )
      return Promise.reject(new CompositionProviderError('COMPOSITION_PROVIDER_INVALID_OUTPUT'));
    const digest = createHash('sha256')
      .update(JSON.stringify({ compositionId: input.compositionId, scenes: input.scenes }))
      .digest('hex');
    const objectKey = `animations/compositions/mock/${digest}.mp4`;
    return Promise.resolve({
      storageProvider: 'MOCK_COMPOSITION',
      objectKey,
      playbackUrl: `https://mock.invalid/${objectKey}`,
      mimeType: 'video/mp4',
      byteSize: null,
      durationSeconds: input.scenes.reduce((sum, scene) => sum + (scene.durationSeconds ?? 0), 0),
      providerRequestId: `mock-composition-${digest.slice(0, 24)}`,
    });
  }
}
