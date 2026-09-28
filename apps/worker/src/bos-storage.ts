import baiduSdk from '@baiducloud/sdk';

type BosPutObjectOptions = {
  'Content-Type': string;
  'Content-Length': number;
};

type BosPutObject = (
  bucket: string,
  objectKey: string,
  body: Buffer,
  options: BosPutObjectOptions,
) => Promise<unknown>;

export type BosPutObjectClient = {
  putObject: BosPutObject;
};

export type BosStorageOptions = {
  bucket: string;
  publicOrigin: string;
  client: BosPutObjectClient;
};

export class BosStorage {
  private readonly publicOrigin: string;

  constructor(private readonly options: BosStorageOptions) {
    this.publicOrigin = options.publicOrigin.replace(/\/$/, '');
  }

  async putImage(input: {
    objectKey: string;
    body: Buffer;
    mimeType: string;
  }): Promise<{ objectKey: string; playbackUrl: string; byteSize: number }> {
    await this.options.client.putObject(this.options.bucket, input.objectKey, input.body, {
      'Content-Type': input.mimeType,
      'Content-Length': input.body.byteLength,
    });
    return {
      objectKey: input.objectKey,
      playbackUrl: `${this.publicOrigin}/${encodeObjectKey(input.objectKey)}`,
      byteSize: input.body.byteLength,
    };
  }
}

export const createBaiduBosStorage = (options: {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicOrigin: string;
}): BosStorage => {
  const client = new baiduSdk.BosClient({
    endpoint: options.endpoint,
    credentials: { ak: options.accessKeyId, sk: options.secretAccessKey },
  });

  return new BosStorage({
    bucket: options.bucket,
    publicOrigin: options.publicOrigin,
    client,
  });
};

const encodeObjectKey = (objectKey: string): string =>
  objectKey
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
