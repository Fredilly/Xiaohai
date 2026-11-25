import { MEIPING_PREFLIGHT_MAX_BYTES } from '@xiaohai/contracts/meiping';

const env = import.meta.env as { readonly VITE_API_BASE_URL?: unknown };
const base = typeof env.VITE_API_BASE_URL === 'string' ? env.VITE_API_BASE_URL : '';

export type StoreMeipingPreflight = {
  sourceStoreId: string;
  sourceChecksum: string;
  totalRows: number;
  matchedRows: number;
  createCandidateRows: number;
  exceptionRows: number;
  metadataWarningRows: number;
  blockingRows: number;
  saleBlockedRows: number;
  assumedInventoryRows: number;
  inventoryApproval: 'PENDING_ADMIN_REVIEW';
};

const reportCounts = [
  'totalRows',
  'matchedRows',
  'createCandidateRows',
  'exceptionRows',
  'metadataWarningRows',
  'blockingRows',
  'saleBlockedRows',
  'assumedInventoryRows',
] as const;

function parseReport(value: unknown, storeId: string): StoreMeipingPreflight {
  if (typeof value !== 'object' || value === null) throw new Error('INVALID_PREFLIGHT_RESPONSE');
  const data = value as Record<string, unknown>;
  if (
    data.sourceType !== 'MEIPING_XLS' ||
    data.sourceStoreId !== storeId ||
    typeof data.sourceChecksum !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(data.sourceChecksum) ||
    data.inventoryApproval !== 'PENDING_ADMIN_REVIEW' ||
    !reportCounts.every((key) => Number.isSafeInteger(data[key]) && (data[key] as number) >= 0) ||
    reportCounts.some(
      (key) => key !== 'totalRows' && (data[key] as number) > (data.totalRows as number),
    ) ||
    (data.matchedRows as number) +
      (data.createCandidateRows as number) +
      (data.exceptionRows as number) !==
      data.totalRows ||
    (data.blockingRows as number) > (data.exceptionRows as number) ||
    data.assumedInventoryRows !== data.totalRows
  )
    throw new Error('INVALID_PREFLIGHT_RESPONSE');
  return data as StoreMeipingPreflight;
}

export function validateMeipingFile(file: { name: string; size: number } | null): string | null {
  if (!file) return '请选择美萍导出的 Excel 文件。';
  if (!/\.xlsx?$/i.test(file.name)) return '仅接受 .xls 或 .xlsx 文件。';
  if (file.size === 0 || file.size > MEIPING_PREFLIGHT_MAX_BYTES)
    return '文件必须非空且不超过 5 MiB。';
  return null;
}

async function requestFile(token: string, storeId: string, file: File, format: 'json' | 'csv') {
  const validation = validateMeipingFile(file);
  if (validation) throw new Error(validation);
  const type = file.name.toLowerCase().endsWith('.xlsx')
    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    : 'application/vnd.ms-excel';
  const response = await fetch(
    `${base}/api/v1/staff/migrations/meiping/preflight?${new URLSearchParams({ storeId, format })}`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': type },
      body: file,
    },
  );
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const error =
      typeof payload === 'object' && payload !== null && 'error' in payload ? payload.error : null;
    const code =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string'
        ? error.code
        : `HTTP_${response.status}`;
    throw new Error(code);
  }
  return response;
}

export async function previewStoreMeiping(token: string, storeId: string, file: File) {
  return parseReport(await (await requestFile(token, storeId, file, 'json')).json(), storeId);
}

export async function downloadStoreMeipingExceptions(token: string, storeId: string, file: File) {
  const response = await requestFile(token, storeId, file, 'csv');
  if (response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'text/csv')
    throw new Error('INVALID_PREFLIGHT_CSV_RESPONSE');
  return await response.blob();
}
