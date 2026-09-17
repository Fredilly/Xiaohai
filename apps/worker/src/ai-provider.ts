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

    let text = `[mock:${input.model}] ${input.prompt}`;

    if (input.prompt.includes('XIAOHAI_TASK=ANIMATION_SCRIPT')) {
      text = JSON.stringify({
        title: '森林里的小灯塔动画',
        synopsis: '小狐狸帮助迷路的小鸟找到回家的方向。',
        script: '清晨，小狐狸在森林里遇见迷路的小鸟。它们一起寻找线索，最终抵达温暖的鸟巢。',
      });
    } else if (input.prompt.includes('XIAOHAI_TASK=ANIMATION_STORYBOARD')) {
      text = JSON.stringify({
        characters: [
          {
            name: '小狐狸',
            role: 'MAIN',
            description: '勇敢温柔的小狐狸',
            visualPrompt: 'orange fox, green scarf, round brown eyes',
          },
        ],
        scenes: [
          {
            scriptText: '小狐狸走进晨光森林。',
            narration: '清晨，森林醒来了。',
            dialogue: [{ speaker: '小狐狸', text: '今天也要帮助朋友。' }],
            visualDescription: '晨光穿过树叶，小狐狸走在林间小路。',
            generationPrompt:
              'cinematic child-safe forest, orange fox with green scarf, morning light',
            plannedDurationMs: 5000,
          },
        ],
      });
    } else if (input.prompt.includes('XIAOHAI_TASK=PICTURE_BOOK_CHARACTERS')) {
      text = JSON.stringify({
        characters: [
          {
            name: '小狐狸',
            role: 'MAIN',
            description: '勇敢、温柔，喜欢帮助朋友的小狐狸',
            visualPrompt: 'orange fox, green scarf, round brown eyes, small white tail tip',
          },
          {
            name: '小鸟',
            role: 'SUPPORTING',
            description: '一只迷路但很有礼貌的小鸟',
            visualPrompt: 'small blue bird, pale yellow chest, tiny red satchel',
          },
        ],
      });
    } else if (input.prompt.includes('XIAOHAI_TASK=PICTURE_BOOK_STORYBOARD')) {
      text = JSON.stringify({
        cover: {
          sceneDescription: '晨光森林里的小狐狸与小鸟',
          illustrationPrompt:
            'storybook cover, orange fox with green scarf and small blue bird with red satchel, forest sunrise',
          layoutPreset: 'AUTO',
        },
        pages: [
          {
            storyText: '清晨，小狐狸沿着森林小路出发。',
            sceneDescription: '森林入口，晨光穿过树叶。',
            illustrationPrompt:
              'orange fox with green scarf and round brown eyes walking on a forest path, morning light',
            layoutPreset: 'AUTO',
          },
          {
            storyText: '它遇见了迷路的小鸟，并决定帮助它回家。',
            sceneDescription: '小狐狸蹲下来安慰背着红色小包的小鸟。',
            illustrationPrompt:
              'orange fox with green scarf beside small blue bird with pale yellow chest and tiny red satchel',
            layoutPreset: 'AUTO',
          },
        ],
      });
    }

    return Promise.resolve({
      text,
      assetReferences: [],
      usage: {
        inputTokens: input.prompt.length,
        outputTokens: text.length,
        totalTokens: input.prompt.length + text.length,
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
