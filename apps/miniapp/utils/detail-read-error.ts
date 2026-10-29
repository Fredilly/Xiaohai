export function detailAccessMessage(error: unknown): string {
  const status = (error as { status?: number } | null)?.status;
  const message = error instanceof Error ? error.message : '';
  if (status === 401) return '请先登录后查看此详情';
  if (status === 403) return '当前账号无权查看此详情';

  switch (message) {
    case 'AUTH_REQUIRED':
    case 'UNAUTHORIZED':
    case 'HTTP_401':
    case 'Content API 401':
    case 'Store API 401':
      return '请先登录后查看此详情';
    case 'FORBIDDEN':
    case 'HTTP_403':
    case 'Content API 403':
    case 'Store API 403':
      return '当前账号无权查看此详情';
    default:
      return '';
  }
}
