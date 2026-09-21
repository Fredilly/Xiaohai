import {
  financeLedgerListResponseSchema,
  financeReconciliationRunSchema,
  financeSummaryResponseSchema,
  type CreateFinanceReconciliationRunRequest,
  type FinanceExportRequest,
  type FinanceLedgerListQuery,
  type FinanceReconciliationRun,
  type FinanceSummaryQuery,
  type FinanceSummaryResponse,
} from '@xiaohai/contracts/finance';

const env = import.meta.env as { readonly VITE_API_BASE_URL?: unknown };
const base =
  typeof env.VITE_API_BASE_URL === 'string' ? env.VITE_API_BASE_URL : 'http://127.0.0.1:3000';

async function parseJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { code?: string };
    } | null;
    throw new Error(payload?.error?.code ?? `HTTP_${response.status}`);
  }
  return response.json() as Promise<unknown>;
}

function queryString(input: Partial<FinanceLedgerListQuery | FinanceSummaryQuery>) {
  const query = new URLSearchParams();
  if (input.from) query.set('from', input.from);
  if (input.to) query.set('to', input.to);
  if ('sourceKind' in input && input.sourceKind) query.set('sourceKind', input.sourceKind);
  if ('eventType' in input && input.eventType) query.set('eventType', input.eventType);
  if ('limit' in input && input.limit !== undefined) query.set('limit', String(input.limit));
  return query.size ? `?${query.toString()}` : '';
}

export async function loadFinanceSummary(
  token: string,
  input: FinanceSummaryQuery = {},
): Promise<FinanceSummaryResponse> {
  const response = await fetch(`${base}/api/v1/staff/finance/summary${queryString(input)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return financeSummaryResponseSchema.parse(await parseJson(response));
}

export async function loadFinanceLedger(token: string, input: FinanceLedgerListQuery) {
  const response = await fetch(`${base}/api/v1/staff/finance/ledger${queryString(input)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return financeLedgerListResponseSchema.parse(await parseJson(response));
}

export async function createFinanceReconciliation(
  token: string,
  input: CreateFinanceReconciliationRunRequest,
): Promise<FinanceReconciliationRun> {
  const response = await fetch(`${base}/api/v1/staff/finance/reconciliation-runs`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  return financeReconciliationRunSchema.parse(await parseJson(response));
}

export async function loadFinanceReconciliation(
  token: string,
  id: string,
): Promise<FinanceReconciliationRun> {
  const response = await fetch(`${base}/api/v1/staff/finance/reconciliation-runs/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return financeReconciliationRunSchema.parse(await parseJson(response));
}

export async function exportFinanceLedger(token: string, input: FinanceExportRequest) {
  const response = await fetch(`${base}/api/v1/staff/finance/exports`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { code?: string };
    } | null;
    throw new Error(payload?.error?.code ?? `HTTP_${response.status}`);
  }

  const disposition = response.headers.get('content-disposition') ?? '';
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'finance-ledger.csv';
  const rowCount = Number(response.headers.get('x-exported-row-count') ?? '0');
  return { csv: await response.text(), filename, rowCount };
}
