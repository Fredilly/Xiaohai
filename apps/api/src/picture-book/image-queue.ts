import { createClient, type RedisClientType } from 'redis';

export interface ImageQueue {
  notify(illustrationId: string): Promise<void>;
  close(): Promise<void>;
}

export class RedisImageQueue implements ImageQueue {
  private readonly client: RedisClientType;
  private connecting: Promise<unknown> | null = null;

  constructor(url: string, onError: () => void = () => {}) {
    this.client = createClient({ url });
    this.client.on('error', onError);
  }

  async notify(illustrationId: string) {
    if (!this.client.isOpen) {
      this.connecting ??= this.client.connect().finally(() => {
        this.connecting = null;
      });
      await this.connecting;
    }
    await this.client.lPush('xiaohai:image:jobs', illustrationId);
  }

  async close() {
    if (this.client.isOpen) await this.client.quit();
  }
}
