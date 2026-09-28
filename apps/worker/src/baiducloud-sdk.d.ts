declare module '@baiducloud/sdk' {
  const sdk: {
    BosClient: new (options: {
      endpoint: string;
      credentials: { ak: string; sk: string };
    }) => unknown;
  };
  export default sdk;
}
