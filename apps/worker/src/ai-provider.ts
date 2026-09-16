import { z } from 'zod';
export interface AiProviderInput {
  model: string;
  prompt: string;
  signal: AbortSignal;
}
export interface AiProviderResult {
  text: string;
  assetReferences: string[];
  providerRequestId?: string;
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  costMetadata: Record<string, unknown>;
}
export interface AiProvider {
  readonly name: 'MOCK' | 'DEEPSEEK';
  generate(input: AiProviderInput): Promise<AiProviderResult>;
}
export class ProviderError extends Error {
  constructor(
    readonly code: 'PROVIDER_TIMEOUT' | 'PROVIDER_UNAVAILABLE' | 'PROVIDER_RESPONSE_INVALID',
  ) {
    super(code);
  }
}
export class MockAiProvider implements AiProvider {
  readonly name = 'MOCK' as const;
  generate(input: AiProviderInput): Promise<AiProviderResult> {
    if (input.signal.aborted) throw new ProviderError('PROVIDER_TIMEOUT');
    return Promise.resolve({
      text: `[mock:${input.model}] ${input.prompt}`,
      assetReferences: [],
      usage: {
        inputTokens: input.prompt.length,
        outputTokens: input.prompt.length + 8,
        totalTokens: input.prompt.length * 2 + 8,
      },
      costMetadata: { source: 'MOCK', billable: false },
    });
  }
}
const responseSchema = z.object({
  id: z.string().optional(),
  choices: z.array(z.object({ message: z.object({ content: z.string().min(1) }) })).min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      completion_tokens: z.number().int().nonnegative().optional(),
      total_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});
export class DeepSeekAiProvider implements AiProvider {
  readonly name = 'DEEPSEEK' as const;
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly http: typeof fetch = fetch,
  ) {}
  async generate(input: AiProviderInput): Promise<AiProviderResult> {
    try {
      const response = await this.http(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        redirect: 'error',
        signal: input.signal,
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: input.model,
          messages: [{ role: 'user', content: input.prompt }],
          stream: false,
        }),
      });
      if (!response.ok) throw new ProviderError('PROVIDER_UNAVAILABLE');
      const parsed = responseSchema.safeParse(await response.json());
      if (!parsed.success) throw new ProviderError('PROVIDER_RESPONSE_INVALID');
      return {
        text: parsed.data.choices[0]!.message.content,
        assetReferences: [],
        providerRequestId: parsed.data.id,
        usage: {
          inputTokens: parsed.data.usage?.prompt_tokens,
          outputTokens: parsed.data.usage?.completion_tokens,
          totalTokens: parsed.data.usage?.total_tokens,
        },
        costMetadata: { source: 'PROVIDER_USAGE_ONLY', amountMinor: null, currency: null },
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (input.signal.aborted) throw new ProviderError('PROVIDER_TIMEOUT');
      throw new ProviderError('PROVIDER_UNAVAILABLE');
    }
  }
}
