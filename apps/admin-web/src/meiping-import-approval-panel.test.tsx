import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MeipingImportApprovalPanel } from './meiping-import-approval-panel';

describe('Meiping import approval panel', () => {
  it('exposes dry-run and independent approval actions without implying automatic import', () => {
    const html = renderToStaticMarkup(
      <MeipingImportApprovalPanel
        token="test"
        storeId="00000000-0000-4000-8000-000000000001"
        sessionId="00000000-0000-4000-8000-000000000002"
        canPreview
        canApprove
        canExecute={false}
      />,
    );
    expect(html).toContain('生成 Dry Run 预览');
    expect(html).not.toContain('记录独立最终批准');
    expect(html).toContain('纠错 ACCEPTED 不等于整批授权');
    expect(html).not.toContain('执行隔离导入');
  });
});
