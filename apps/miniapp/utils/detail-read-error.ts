export function detailAccessMessage(error: unknown): string {
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? (error as { status?: unknown }).status
      : undefined;
  const message = error instanceof Error ? error.message : '';
  const isUnauthorized =
    status === 401 ||
    /(?:^AUTH_REQUIRED$|(?:API |HTTP_)401\b|^UNAUTHORIZED$)/.test(message);
  const isForbidden =
    status === 403 || /(?:^FORBIDDEN$|(?:API |HTTP_)403\b)/.test(message);
  if (isUnauthorized) return '请先登录后查看此详情';
  if (isForbidden) return '当前账号无权查看此详情';
  return '';
}
