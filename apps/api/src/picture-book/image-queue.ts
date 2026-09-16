import { createClient, type RedisClientType } from 'redis';

export interface ImageQueue {
  notify(illustrationId: string): Promise<void>;
  close(): Promise<void>;
}

export class RedisImageQueue implements ImageQueue {
  private readonly client: RedisClientType;

  constructor(url: string, onError: () => void = () => {}) {
    this.client = createClient({ url });
    this.client.on('error', onError);
  }

  async notify(illustrationId: string) {
    if (!this.client.isOpen) await this.client.connect();
    await this.client.lPush('xiaohai:image:jobs', illustrationId);
  }

  async close() {
    if (this.client.isOpen) await this.client.quit();
  }
}
