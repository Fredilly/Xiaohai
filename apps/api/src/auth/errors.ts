import type { ApiErrorCode } from '@xiaohai/contracts';

export class ConsumerAuthError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    public readonly statusCode: number,
  ) {
    super(code);
    this.name = 'ConsumerAuthError';
  }
}

export class WeChatProviderError extends ConsumerAuthError {}
