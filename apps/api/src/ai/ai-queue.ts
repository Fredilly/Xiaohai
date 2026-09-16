import { createClient, type RedisClientType } from 'redis';

export interface AiQueue {
  notify(jobId: string): Promise<void>;
  close(): Promise<void>;
}
export class RedisAiQueue implements AiQueue {
  private readonly client: RedisClientType;
  private connecting: Promise<unknown> | null = null;
  constructor(url: string, onError: () => void = () => {}) {
    this.client = createClient({ url });
    this.client.on('error', onError);
  }
  private async ready() {
    if (!this.client.isOpen) {
      this.connecting ??= this.client.connect().finally(() => {
        this.connecting = null;
      });
      await this.connecting;
    }
  }
  async notify(jobId: string) {
    await this.ready();
    await this.client.lPush('xiaohai:ai:jobs', jobId);
  }
  async close() {
    if (this.client.isOpen) await this.client.quit();
  }
}
