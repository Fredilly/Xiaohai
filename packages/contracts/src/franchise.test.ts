import { describe, expect, it } from 'vitest';
import {
  assignFranchiseApplicationRequestSchema,
  createFranchiseApplicationRequestSchema,
  createFranchiseFollowupRequestSchema,
  updateFranchiseApplicationStatusRequestSchema,
} from './franchise.js';

describe('M17 franchise contracts', () => {
  it('accepts a valid public application and rejects server-controlled fields', () => {
    const input = {
      name: '申请人',
      phone: '13800138000',
      email: 'franchise@example.com',
      country: '中国',
      region: '四川',
      city: '成都',
      district: '武侯区',
      background: '零售运营经验',
      message: '希望了解加盟。',
    };
    expect(createFranchiseApplicationRequestSchema.safeParse(input).success).toBe(true);
    expect(
      createFranchiseApplicationRequestSchema.safeParse({ ...input, status: 'APPROVED' }).success,
    ).toBe(false);
    expect(
      createFranchiseApplicationRequestSchema.safeParse({
        ...input,
        assignedStaffAccountId: crypto.randomUUID(),
      }).success,
    ).toBe(false);
  });

  it('requires optimistic versions on staff writes', () => {
    expect(
      assignFranchiseApplicationRequestSchema.safeParse({
        staffAccountId: crypto.randomUUID(),
        version: 1,
      }).success,
    ).toBe(true);
    expect(
      createFranchiseFollowupRequestSchema.safeParse({
        channel: 'PHONE',
        note: '电话沟通',
        version: 2,
      }).success,
    ).toBe(true);
    expect(
      updateFranchiseApplicationStatusRequestSchema.safeParse({ status: 'OPENED', version: 0 })
        .success,
    ).toBe(false);
  });
});
