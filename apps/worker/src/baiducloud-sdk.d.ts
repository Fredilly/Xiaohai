// @baiducloud/sdk 1.0.7 ships a types/ directory but does not expose it via
// package.json, so TypeScript cannot discover the declarations for the runtime
// package automatically. Keep this compatibility declaration limited to the
// BOS surface used by the Worker and mirror the SDK's real putObject call shape.
declare module '@baiducloud/sdk' {
  type BosPutObjectOptions = {
    'Content-Type'?: string;
    'Content-Length'?: number;
    [header: string]: string | number | undefined;
  };

  type BosClient = {
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
