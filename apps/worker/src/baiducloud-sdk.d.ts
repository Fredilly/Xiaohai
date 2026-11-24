// @baiducloud/sdk 1.0.7 ships a types/ directory but does not expose it via
// package.json, so TypeScript cannot discover the declarations for the runtime
// package automatically. Keep this compatibility declaration limited to the
// BOS surface used by the Worker: existing putObject and real SDK 1.0.7
// generatePresignedUrl signatures, also used by the API's private playback.
declare module '@baiducloud/sdk' {
  type BosPutObjectOptions = {
    'Content-Type'?: string;
    'Content-Length'?: number;
    [header: string]: string | number | undefined;
  };

  type BosClient = {
    generatePresignedUrl(
      bucket: string,
      key: string,
      timestampSeconds: number,
      expirationSeconds: number,
      headers?: Record<string, string>,
      params?: Record<string, string>,
      headersToSign?: Record<string, string>,
    ): string;
    putObject(
      bucket: string,
      key: string,
      data: Buffer,
      options?: BosPutObjectOptions,
    ): Promise<unknown>;
  };

  const sdk: {
    BosClient: new (options: {
      endpoint: string;
      credentials: { ak: string; sk: string };
    }) => BosClient;
  };

  export default sdk;
}
