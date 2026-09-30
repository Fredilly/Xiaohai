import { parseStructuredStoryJson } from '@xiaohai/contracts/story';
import { ProviderError } from './ai-provider.js';

type AiJobInput = {
  context?: unknown;
};

type StructuredStoryContext = {
  kind: 'STORY';
  operation: 'BODY';
  outputFormat: 'STRUCTURED_STORY';
  requestedPageCount: number;
};

function readStructuredStoryContext(input: AiJobInput): StructuredStoryContext | null {
  if (!input.context || typeof input.context !== 'object') return null;
  const context = input.context as Partial<StructuredStoryContext>;

  if (
    context.kind !== 'STORY' ||
    context.operation !== 'BODY' ||
    context.outputFormat !== 'STRUCTURED_STORY' ||
    typeof context.requestedPageCount !== 'number'
  ) {
    return null;
  }

  return context as StructuredStoryContext;
}

export function expectsStructuredStory(input: AiJobInput) {
  return readStructuredStoryContext(input) !== null;
}

export function validateAndNormalizeAiOutput(input: AiJobInput, text: string) {
  const context = readStructuredStoryContext(input);
  if (!context) return text;

  try {
    return JSON.stringify(parseStructuredStoryJson(text, context.requestedPageCount));
  } catch {
    throw new ProviderError('PROVIDER_RESPONSE_INVALID');
  }
}
