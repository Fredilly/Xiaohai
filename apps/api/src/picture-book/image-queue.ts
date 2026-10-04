import { createClient, type RedisClientType } from 'redis';

export interface ImageQueue {
  notify(imageJobId: string): Promise<void>;
  close(): Promise<void>;
}

export class RedisImageQueue implements ImageQueue {
  private readonly client: RedisClientType;
  private connecting: Promise<unknown> | null = null;

  constructor(url: string, onError: () => void = () => {}) {
    this.client = createClient({ url });
    this.client.on('error', onError);
  }

  async notify(imageJobId: string) {
    if (!this.client.isOpen) {
      this.connecting ??= this.client.connect().finally(() => {
        this.connecting = null;
      });
      await this.connecting;
    }
    await this.client.lPush('xiaohai:image:jobs', imageJobId);
  }

  async close() {
    if (this.client.isOpen) await this.client.quit();
  }
}
