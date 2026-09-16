import { createClient, type RedisClientType } from 'redis';

export interface VideoQueue {
  notify(generationId: string): Promise<void>;
  close(): Promise<void>;
}

export class RedisVideoQueue implements VideoQueue {
  private readonly client: RedisClientType;
  private connecting: Promise<unknown> | null = null;

  constructor(url: string, onError: () => void = () => {}) {
    this.client = createClient({ url });
    this.client.on('error', onError);
  }

  async notify(generationId: string) {
    if (!this.client.isOpen) {
      this.connecting ??= this.client.connect().finally(() => {
        this.connecting = null;
      });
      await this.connecting;
    }

    await this.client.lPush('xiaohai:animation:jobs', generationId);
  }

  async close() {
    if (this.client.isOpen) await this.client.quit();
  }
}
