export type MeipingIssue = {
  sourceRowNumber: number;
  code: string;
  severity: 'WARNING' | 'ERROR';
  message: string;
};

export type MeipingPreflightRow = {
  sourceRowNumber: number;
  sourceCategory: string | null;
  sourceCategoryType: 'BOOK' | 'NON_BOOK' | 'UNKNOWN';
  sourceIdentifiers: {
    bookCode: string | null;
    internalCode: string | null;
    barcode: string | null;
    isbn: string | null;
  };
  normalized: {
    title: string | null;
    author: string | null;
    publisher: string | null;
    priceMinor: number | null;
  };
  plannedInventory: 1;
  inventoryBasis: 'ASSUMED_PENDING_STOCKTAKE';
  matchStatus: 'MATCHED_BY_EXPLICIT_ISBN' | 'UNMATCHED_REVIEW';
  disposition: 'MATCHED' | 'CREATE_CANDIDATE' | 'REVIEW' | 'REJECTED' | 'DUPLICATE';
  issues: MeipingIssue[];
};

export type MeipingPreflightReport = {
  sourceType: 'MEIPING_XLS';
  sourceChecksum?: string;
  sourceStoreId: string;
  sourceStoreCode: string;
  inventoryApproval: 'PENDING_ADMIN_REVIEW';
  totalRows: number;
  matchedRows: number;
  createCandidateRows: number;
  exceptionRows: number;
  assumedInventoryRows: number;
  plannedInventoryTotal: number;
  rows: MeipingPreflightRow[];
  exceptionReportCsv: string;
  sheetName: string;
  headers: string[];
  missingMappedFields: string[];
};

const configuredBase: unknown = import.meta.env.VITE_API_BASE_URL;
const base = typeof configuredBase === 'string' ? configuredBase : 'http://127.0.0.1:3000';

export class MeipingPreflightApiError extends Error {
  constructor(
    readonly status: number,
    readonly code?: string,
  ) {
    super(code ? `Meiping preflight ${code}` : `Meiping preflight HTTP ${status}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseReport(value: unknown): MeipingPreflightReport {
  if (
    !isRecord(value) ||
    value.sourceType !== 'MEIPING_XLS' ||
    !Array.isArray(value.rows) ||
    typeof value.totalRows !== 'number' ||
    typeof value.exceptionReportCsv !== 'string'
  ) {
    throw new Error('INVALID_PREFLIGHT_RESPONSE');
  }
  return value as unknown as MeipingPreflightReport;
}

async function readErrorCode(response: Response): Promise<string | undefined> {
  const payload: unknown = await response.json().catch(() => null);
  if (!isRecord(payload)) return undefined;
  const error = payload.error;
  return isRecord(error) && typeof error.code === 'string' ? error.code : undefined;
}

function contentType(file: Blob & { readonly name?: string }): string {
  if (file.type) return file.type;
  return file.name?.toLowerCase().endsWith('.xlsx')
    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    : 'application/vnd.ms-excel';
}

async function postFile(
  token: string,
  storeId: string,
  file: Blob & { readonly name?: string },
  format: 'json' | 'csv',
): Promise<Response> {
  const response = await fetch(
    `${base}/api/v1/staff/migrations/meiping/preflight?${new URLSearchParams({
      storeId,
      format,
    })}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': contentType(file),
      },
      body: file,
    },
  );
  if (!response.ok)
    throw new MeipingPreflightApiError(response.status, await readErrorCode(response));
  return response;
}

export async function preflightMeipingFile(
  token: string,
  storeId: string,
  file: Blob & { readonly name?: string },
): Promise<MeipingPreflightReport> {
  return parseReport(await (await postFile(token, storeId, file, 'json')).json());
}

export async function downloadMeipingExceptions(
  token: string,
  storeId: string,
  file: Blob & { readonly name?: string },
): Promise<Blob> {
  return (await postFile(token, storeId, file, 'csv')).blob();
}
