// @baiducloud/sdk 1.0.7 ships types but does not expose them in package.json.
// Mirror only the BOS GET URL signing method used by this API.
declare module '@baiducloud/sdk' {
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
  };

  const sdk: {
    BosClient: new (options: {
      endpoint: string;
      credentials: { ak: string; sk: string };
    }) => BosClient;
  };

  export default sdk;
}
