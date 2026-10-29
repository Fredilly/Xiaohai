export const MEIPING_CORRECTION_REVIEW_PERMISSION = 'meiping.correction.review';

export function meipingReviewPermissions(permissions: readonly string[]) {
  const canEditReview =
    permissions.includes('inventory.receive') && permissions.includes('inventory.stocktake');
  const canVerifyCorrection = permissions.includes(MEIPING_CORRECTION_REVIEW_PERMISSION);
  return {
    canReadReview: canEditReview || canVerifyCorrection,
    canEditReview,
    canVerifyCorrection,
  };
}
