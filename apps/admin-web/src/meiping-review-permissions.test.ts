import { describe, expect, it } from 'vitest';
import { meipingReviewPermissions } from './meiping-review-permissions';

describe('Meiping review permission boundaries', () => {
  it('allows an independently scoped reviewer to read and verify only', () => {
    expect(meipingReviewPermissions(['stores.read', 'meiping.correction.review'])).toEqual({
      canReadReview: true,
      canEditReview: false,
      canVerifyCorrection: true,
    });
  });

  it('keeps the original receive and stocktake edit boundary', () => {
    expect(meipingReviewPermissions(['inventory.receive', 'inventory.stocktake'])).toEqual({
      canReadReview: true,
      canEditReview: true,
      canVerifyCorrection: false,
    });
  });

  it('does not treat stocktake alone as permission to edit or read the review flow', () => {
    expect(meipingReviewPermissions(['inventory.stocktake'])).toEqual({
      canReadReview: false,
      canEditReview: false,
      canVerifyCorrection: false,
    });
  });
});
