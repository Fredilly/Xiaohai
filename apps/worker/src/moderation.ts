export type ModerationResult = {
  status: 'PASSED' | 'BLOCKED' | 'REVIEW_REQUIRED';
  reasonCodes: string[];
};
export interface ModerationAdapter {
  moderate(text: string, phase: 'INPUT' | 'OUTPUT'): Promise<ModerationResult>;
}
export class BaselineModerationAdapter implements ModerationAdapter {
  moderate(text: string, _phase: 'INPUT' | 'OUTPUT'): Promise<ModerationResult> {
    void _phase;
    const normalized = text.trim();
    if (!normalized) return Promise.resolve({ status: 'BLOCKED', reasonCodes: ['EMPTY_CONTENT'] });
    if (normalized.length > 20000)
      return Promise.resolve({ status: 'BLOCKED', reasonCodes: ['CONTENT_TOO_LONG'] });
    return Promise.resolve({
      status: 'REVIEW_REQUIRED',
      reasonCodes: ['PRODUCTION_POLICY_NOT_CONFIGURED'],
    });
  }
}
