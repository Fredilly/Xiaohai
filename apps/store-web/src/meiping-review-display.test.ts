import { describe, expect, it } from 'vitest';
import {
  meipingDispositionLabel,
  meipingIssueLabel,
  meipingSessionStatusLabel,
} from './meiping-review-display';

describe('Store Web human-readable Meiping labels', () => {
  it('uses staff-friendly language instead of exposing technical state names', () => {
    expect(meipingSessionStatusLabel('DRAFT')).toBe('审核草稿（未正式入库）');
    expect(meipingDispositionLabel('REVIEW')).toBe('需要人工核对');
    expect(meipingDispositionLabel('CREATE_CANDIDATE')).toContain('不入库');
    expect(meipingDispositionLabel('MATCHED')).toContain('待确认');
  });

  it('translates source warning codes, without modifying the original raw code', () => {
    expect(meipingIssueLabel('BARCODE_CONFLICT')).toBe('相同条码对应不同书名或价格');
    expect(meipingIssueLabel('ZERO_PRICE')).toBe('价格为零，不能正常销售');
    expect(meipingIssueLabel('PUBLISHER_MISSING')).toBe('出版社信息缺失');
    expect(meipingIssueLabel('DUPLICATE_ROW')).toContain('重复记录');
  });

  it('falls back to a safe, readable phrase for unknown exception codes', () => {
    expect(meipingIssueLabel('FUTURE_EXCEPTION_CODE')).toBe('其他需人工核实的问题');
  });
});
