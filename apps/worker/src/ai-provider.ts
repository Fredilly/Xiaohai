import { z } from 'zod';
export interface AiProviderInput {
  model: string;
  prompt: string;
  signal: AbortSignal;
  responseFormat?: 'json_object';
}
export interface AiProviderResult {
  text: string;
  assetReferences: string[];
  providerRequestId?: string;
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  costMetadata: Record<string, unknown>;
}
export interface AiProvider {
  readonly name: 'MOCK' | 'DEEPSEEK' | 'BAILIAN';
  generate(input: AiProviderInput): Promise<AiProviderResult>;
}
export type ProviderFailureMetadata = {
  source: string;
  latencyMs: number;
  failureType: 'AUTHENTICATION' | 'RATE_LIMIT' | 'SERVER' | 'NETWORK' | 'TIMEOUT';
  httpStatus?: number;
};
export class ProviderError extends Error {
  constructor(
    readonly code: 'PROVIDER_TIMEOUT' | 'PROVIDER_UNAVAILABLE' | 'PROVIDER_RESPONSE_INVALID',
    readonly providerRequestId?: string,
    readonly failureMetadata?: ProviderFailureMetadata,
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
      const characterNames = Array.from(
        input.prompt.matchAll(/^(.+?)\s+\[(?:MAIN|SUPPORTING)\]\s+consistencyKey=/gm),
        (match) => match[1]!.trim(),
      )
        .filter((name, index, names) => name.length > 0 && names.indexOf(name) === index)
        .slice(0, 3);
      if (characterNames.length === 0) {
        throw new ProviderError('PROVIDER_RESPONSE_INVALID');
      }
      const primary = characterNames[0]!;
      const secondary = characterNames[1] ?? primary;
      text = JSON.stringify({
        cover: {
          characterKeys: characterNames,
          sceneDescription: `故事角色 ${characterNames.join(' 与 ')} 的温暖场景`,
          illustrationPrompt: `storybook cover featuring ${characterNames.join(' and ')}, forest sunrise`,
          layoutPreset: 'AUTO',
        },
        pages: [
          {
            characterKeys: [primary],
            storyText: `${primary} 踏上了一段新的旅程。`,
            sceneDescription: '森林入口，晨光穿过树叶。',
            illustrationPrompt: `${primary} walking on a forest path in morning light`,
            layoutPreset: 'AUTO',
          },
          {
            characterKeys: characterNames.length > 1 ? [primary, secondary] : [primary],
            storyText: `${primary} 与 ${secondary} 一起解决了旅途中的难题。`,
            sceneDescription: `森林小路上，${primary} 与 ${secondary} 互相帮助。`,
            illustrationPrompt: `${primary} beside ${secondary} in a child-safe forest scene`,
            layoutPreset: 'AUTO',
          },
        ],
      });
    } else if (input.prompt.includes('XIAOHAI_TASK=STRUCTURED_STORY')) {
      const requestedPageCount = Number(
        input.prompt.match(/REQUESTED_PAGE_COUNT=(1[0-5])/)?.[1] ?? 10,
      );
      text = JSON.stringify({
        title: '森林里的小灯塔',
        outline: '小狐狸帮助迷路的小鸟找到回家的路，并学会勇敢地承担责任。',
        characters: [
          {
            name: '小狐狸',
            description: '勇敢、温柔，愿意帮助朋友的主角。',
            visualDescription: '橙色短毛、圆圆的棕色眼睛、绿色围巾和白色尾尖。',
          },
          {
            name: '小鸟',
            description: '有礼貌、会认真观察线索的伙伴。',
            visualDescription: '蓝色羽毛、淡黄色胸口、背着小小的红色挎包。',
          },
        ],
        pages: Array.from({ length: requestedPageCount }, (_, index) => ({
          pageNumber: index + 1,
          scene: `森林旅程的第 ${index + 1} 个场景`,
          text: `这是森林旅程的第 ${index + 1} 页，小狐狸和小鸟继续寻找回家的方向。`,
        })),
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
export class BailianAiProvider implements AiProvider {
  readonly name = 'BAILIAN' as const;
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly http: typeof fetch = fetch,
    private readonly metadataSource = 'BAILIAN_USAGE_ONLY',
  ) {}
  async generate(input: AiProviderInput): Promise<AiProviderResult> {
    const startedAt = Date.now();
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
          ...(input.responseFormat ? { response_format: { type: input.responseFormat } } : {}),
        }),
      });
      const providerRequestId = response.headers.get('x-request-id') ?? undefined;
      if (!response.ok) {
        throw new ProviderError('PROVIDER_UNAVAILABLE', providerRequestId, {
          source: this.metadataSource,
          latencyMs: Date.now() - startedAt,
          failureType:
            response.status === 401 || response.status === 403
              ? 'AUTHENTICATION'
              : response.status === 429
                ? 'RATE_LIMIT'
                : 'SERVER',
          httpStatus: response.status,
        });
      }
      const parsed = responseSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new ProviderError('PROVIDER_RESPONSE_INVALID', providerRequestId, {
          source: this.metadataSource,
          latencyMs: Date.now() - startedAt,
          failureType: 'SERVER',
          httpStatus: response.status,
        });
      }
      return {
        text: parsed.data.choices[0]!.message.content,
        assetReferences: [],
        providerRequestId: providerRequestId ?? parsed.data.id,
        usage: {
          inputTokens: parsed.data.usage?.prompt_tokens,
          outputTokens: parsed.data.usage?.completion_tokens,
          totalTokens: parsed.data.usage?.total_tokens,
        },
        costMetadata: {
          source: this.metadataSource,
          amountMinor: null,
          currency: null,
          latencyMs: Date.now() - startedAt,
        },
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (input.signal.aborted)
        throw new ProviderError('PROVIDER_TIMEOUT', undefined, {
          source: this.metadataSource,
          latencyMs: Date.now() - startedAt,
          failureType: 'TIMEOUT',
        });
      throw new ProviderError('PROVIDER_UNAVAILABLE', undefined, {
        source: this.metadataSource,
        latencyMs: Date.now() - startedAt,
        failureType: 'NETWORK',
      });
    }
  }
}

/**
 * Issue #80's QWEN configuration name uses the same DashScope
 * OpenAI-compatible transport already implemented for Bailian. Keep one
 * adapter implementation and one canonical database provider value.
 */
export class QwenAiProvider extends BailianAiProvider {
  constructor(apiKey: string, baseUrl: string, http: typeof fetch = fetch) {
    super(apiKey, baseUrl, http, 'QWEN_USAGE_ONLY');
  }
}

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
          ...(input.responseFormat ? { response_format: { type: input.responseFormat } } : {}),
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
