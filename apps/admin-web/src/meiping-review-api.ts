export type ReviewDecision = {
  sourceRowNumber: number;
  action: 'CREATE_DRAFT' | 'EXCLUDE';
  countedQuantity: number | null;
  reason: string | null;
  version: number;
  updatedAt: string;
};
export type ReviewDecisionHistory = ReviewDecision & { capturedAt: string };
export type ReviewCorrection = {
  sourceRowNumber: number;
  proposedFields: Partial<{
    title: string;
    author: string;
    publisher: string;
    barcode: string;
    priceMinor: number;
  }>;
  reason: string;
  version: number;
  updatedAt: string;
};
export type ReviewCorrectionHistory = ReviewCorrection & { capturedAt: string };
export type ReviewCorrectionInput = {
  expectedChecksum: string;
  expectedVersion: number;
  proposedFields: ReviewCorrection['proposedFields'];
  reason: string;
};
export type CorrectionReview = {
  sourceRowNumber: number;
  correctionVersion: number;
  verdict: 'ACCEPTED' | 'REJECTED';
  reason: string;
  reviewedAt: string;
};
export type CorrectionReviewInput = {
  expectedChecksum: string;
  expectedCorrectionVersion: number;
  verdict: CorrectionReview['verdict'];
  reason: string;
};
export type ReviewItem = {
  sourceRowNumber: number;
  disposition: 'MATCHED' | 'CREATE_CANDIDATE' | 'REVIEW' | 'REJECTED' | 'DUPLICATE';
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
  issueCodes: string[];
  saleBlocked: boolean;
  decision: ReviewDecision | null;
  decisionHistory?: ReviewDecisionHistory[];
  correction?: ReviewCorrection | null;
  correctionHistory?: ReviewCorrectionHistory[];
  correctionReview?: CorrectionReview | null;
};
export type ReviewSession = {
  id: string;
  created: boolean;
  status: 'DRAFT';
  sourceChecksum: string;
  storeId: string;
  totalRows: number;
  approved: false;
  catalogOrInventoryWritten: false;
};
export type ReviewPage = {
  sessionId: string;
  storeId: string;
  sourceChecksum: string;
  status: 'DRAFT';
  approved: false;
  catalogOrInventoryWritten: false;
  totalRows: number;
  offset: number;
  limit: number;
  items: ReviewItem[];
};
export type ReviewSessionSummary = {
  id: string;
  storeId: string;
  status: 'DRAFT';
  sourceChecksum: string;
  totalRows: number;
  savedDecisions: number;
  createdAt: string;
  approved: false;
  catalogOrInventoryWritten: false;
};
export type ReviewSessionList = {
  storeId: string;
  offset: number;
  limit: number;
  hasMore: boolean;
  items: ReviewSessionSummary[];
};
export type ReviewDecisionInput =
  | {
      sourceRowNumber: number;
      action: 'CREATE_DRAFT';
      countedQuantity: number;
      expectedVersion: number;
      expectedChecksum: string;
    }
  | {
      sourceRowNumber: number;
      action: 'EXCLUDE';
      reason: string;
      expectedVersion: number;
      expectedChecksum: string;
    };

const configuredBase: unknown = import.meta.env.VITE_API_BASE_URL;
const base =
  typeof configuredBase === 'string' ? configuredBase.replace(/\/$/, '') : 'http://127.0.0.1:3000';
const root = base + '/api/v1/staff/migrations/meiping/review-sessions';

export class MeipingReviewApiError extends Error {
  constructor(
    readonly status: number,
    readonly code?: string,
  ) {
    super(code ?? 'REVIEW_HTTP_' + status);
  }
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
async function parseError(response: Response): Promise<MeipingReviewApiError> {
  const payload: unknown = await response.json().catch(() => null);
  const error = object(payload) ? payload.error : null;
  return new MeipingReviewApiError(
    response.status,
    object(error) && typeof error.code === 'string' ? error.code : undefined,
  );
}
function headers(token: string) {
  return { Authorization: 'Bearer ' + token };
}
function query(storeId: string, extra: Record<string, string> = {}) {
  return '?' + new URLSearchParams({ storeId, ...extra }).toString();
}
function assertSession(value: unknown): ReviewSession {
  if (
    !object(value) ||
    typeof value.id !== 'string' ||
    value.status !== 'DRAFT' ||
    typeof value.sourceChecksum !== 'string' ||
    typeof value.storeId !== 'string' ||
    typeof value.totalRows !== 'number' ||
    value.approved !== false ||
    value.catalogOrInventoryWritten !== false
  ) {
    throw new Error('INVALID_REVIEW_SESSION_RESPONSE');
  }
  return value as ReviewSession;
}
function assertPage(value: unknown): ReviewPage {
  if (
    !object(value) ||
    !Array.isArray(value.items) ||
    typeof value.sessionId !== 'string' ||
    typeof value.storeId !== 'string' ||
    typeof value.sourceChecksum !== 'string' ||
    typeof value.totalRows !== 'number' ||
    value.approved !== false ||
    value.catalogOrInventoryWritten !== false
  ) {
    throw new Error('INVALID_REVIEW_PAGE_RESPONSE');
  }
  return value as ReviewPage;
}
export async function listMeipingReviewSessions(
  token: string,
  storeId: string,
  offset = 0,
  limit = 20,
): Promise<ReviewSessionList> {
  const response = await fetch(
    root + query(storeId, { offset: String(offset), limit: String(limit) }),
    {
      headers: headers(token),
    },
  );
  if (!response.ok) throw await parseError(response);
  const result: unknown = await response.json();
  if (
    !object(result) ||
    result.storeId !== storeId ||
    result.offset !== offset ||
    result.limit !== limit ||
    typeof result.hasMore !== 'boolean' ||
    !Array.isArray(result.items)
  )
    throw new Error('INVALID_REVIEW_SESSION_LIST_RESPONSE');
  for (const item of result.items) {
    if (
      !object(item) ||
      typeof item.id !== 'string' ||
      item.storeId !== storeId ||
      item.status !== 'DRAFT' ||
      typeof item.sourceChecksum !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(item.sourceChecksum) ||
      typeof item.totalRows !== 'number' ||
      !Number.isSafeInteger(item.totalRows) ||
      item.totalRows < 1 ||
      typeof item.savedDecisions !== 'number' ||
      !Number.isSafeInteger(item.savedDecisions) ||
      item.savedDecisions < 0 ||
      item.savedDecisions > item.totalRows ||
      typeof item.createdAt !== 'string' ||
      item.approved !== false ||
      item.catalogOrInventoryWritten !== false
    ) {
      throw new Error('INVALID_REVIEW_SESSION_LIST_RESPONSE');
    }
  }
  return result as ReviewSessionList;
}
export async function createMeipingReviewSession(
  token: string,
  storeId: string,
  file: File,
): Promise<ReviewSession> {
  const type =
    file.type ||
    (file.name.toLowerCase().endsWith('.xlsx')
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'application/vnd.ms-excel');
  const response = await fetch(root + query(storeId), {
    method: 'POST',
    headers: { ...headers(token), 'content-type': type },
    body: file,
  });
  if (!response.ok) throw await parseError(response);
  return assertSession(await response.json());
}
export async function getMeipingReviewPage(
  token: string,
  storeId: string,
  sessionId: string,
  offset: number,
  limit = 50,
): Promise<ReviewPage> {
  const response = await fetch(
    root +
      '/' +
      encodeURIComponent(sessionId) +
      query(storeId, { offset: String(offset), limit: String(limit) }),
    {
      headers: headers(token),
    },
  );
  if (!response.ok) throw await parseError(response);
  const page = assertPage(await response.json());
  if (page.storeId !== storeId || page.sessionId !== sessionId || page.offset !== offset) {
    throw new Error('REVIEW_PAGE_CONTEXT_MISMATCH');
  }
  return page;
}
export async function saveMeipingReviewCorrection(
  token: string,
  storeId: string,
  sessionId: string,
  sourceRowNumber: number,
  proposal: ReviewCorrectionInput,
): Promise<{ version: number; status: 'PENDING_VERIFICATION' }> {
  const response = await fetch(
    root + '/' + encodeURIComponent(sessionId) + '/corrections/' + sourceRowNumber + query(storeId),
    {
      method: 'PUT',
      headers: { ...headers(token), 'content-type': 'application/json' },
      body: JSON.stringify(proposal),
    },
  );
  if (!response.ok) throw await parseError(response);
  const payload: unknown = await response.json();
  if (
    !object(payload) ||
    payload.sourceRowNumber !== sourceRowNumber ||
    payload.status !== 'PENDING_VERIFICATION' ||
    typeof payload.version !== 'number' ||
    payload.approved !== false ||
    payload.catalogOrInventoryWritten !== false
  ) {
    throw new Error('INVALID_CORRECTION_RESPONSE');
  }
  return { version: payload.version, status: 'PENDING_VERIFICATION' };
}

export async function saveMeipingCorrectionReview(
  token: string,
  storeId: string,
  sessionId: string,
  sourceRowNumber: number,
  body: CorrectionReviewInput,
): Promise<{ correctionVersion: number; verdict: CorrectionReview['verdict'] }> {
  const response = await fetch(
    root +
      '/' +
      encodeURIComponent(sessionId) +
      '/corrections/' +
      sourceRowNumber +
      '/review' +
      query(storeId),
    {
      method: 'POST',
      headers: { ...headers(token), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw await parseError(response);
  const result: unknown = await response.json();
  if (
    !object(result) ||
    result.sourceRowNumber !== sourceRowNumber ||
    result.correctionVersion !== body.expectedCorrectionVersion ||
    (result.verdict !== 'ACCEPTED' && result.verdict !== 'REJECTED') ||
    result.approved !== false ||
    result.catalogOrInventoryWritten !== false
  ) {
    throw new Error('INVALID_CORRECTION_REVIEW_RESPONSE');
  }
  return {
    correctionVersion: result.correctionVersion,
    verdict: result.verdict,
  };
}

export async function saveMeipingReviewDecision(
  token: string,
  storeId: string,
  sessionId: string,
  decision: ReviewDecisionInput,
): Promise<{ version: number }> {
  const response = await fetch(
    root +
      '/' +
      encodeURIComponent(sessionId) +
      '/decisions/' +
      decision.sourceRowNumber +
      query(storeId),
    {
      method: 'PUT',
      headers: { ...headers(token), 'content-type': 'application/json' },
      body: JSON.stringify(decision),
    },
  );
  if (!response.ok) throw await parseError(response);
  const result: unknown = await response.json();
  if (
    !object(result) ||
    typeof result.version !== 'number' ||
    result.approved !== false ||
    result.catalogOrInventoryWritten !== false
  ) {
    throw new Error('INVALID_DECISION_RESPONSE');
  }
  return { version: result.version };
}
