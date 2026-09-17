import { createClient, type RedisClientType } from 'redis';

export interface CompositionQueue {
  notify(compositionId: string): Promise<void>;
  close(): Promise<void>;
}

export class RedisCompositionQueue implements CompositionQueue {
  private readonly client: RedisClientType;
  private connecting: Promise<unknown> | null = null;
  constructor(url: string, onError: () => void = () => {}) {
    this.client = createClient({ url });
    this.client.on('error', onError);
  }
  async notify(compositionId: string) {
    if (!this.client.isOpen) {
      this.connecting ??= this.client.connect().finally(() => {
        this.connecting = null;
      });
      await this.connecting;
    }
    await this.client.lPush('xiaohai:animation:compositions', compositionId);
  }
  async close() {
    if (this.client.isOpen) await this.client.quit();
  }
}
