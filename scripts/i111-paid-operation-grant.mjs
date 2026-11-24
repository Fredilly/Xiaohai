import { I111_ONE_SHOT_SCOPE } from './i111-one-shot-policy.mjs';

/**
 * A new, independent owner operation grant is mandatory for each #111 paid
 * acceptance batch. A GitHub PR review (including APPROVED) is code review,
 * never operation permission. This module is deliberately pure: callers must
 * collect comments from the authenticated GitHub API, not local JSON or flags.
 *
 * For the owner to make an unambiguous grant, the entire GitHub issue comment
 * body must be a single JSON object with the format below. No free-form text,
 * markdown fences, aliases or partial approvals are accepted.
 */
export const I111_OPERATION_GRANT_SCHEMA = 1;

const OWNER_LOGIN = 'Fredilly';
const ISSUE_NUMBER = 111;
const SHA = /^[0-9a-f]{40}$/u;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;
const ALLOWED_WINDOW_MS = 24 * 60 * 60 * 1000;

function exactFields(object, expected) {
  return (
    object &&
    !Array.isArray(object) &&
    typeof object === 'object' &&
    Object.keys(object).length === expected.length &&
    expected.every((key) => Object.hasOwn(object, key))
  );
}

function parsedUtc(value) {
  if (typeof value !== 'string' || !UTC.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value.replace(/Z$/, '.000Z')
    ? ms
    : null;
}

/**
 * Pure schema classifier, NOT an authorization function. Supplied comments
 * could be forged: only verifyI111PaidGrantFromGitHub can return the sentinel
 * recognized by the executor. Never expose this classifier as a grant port.
 */
export function classifyI111PaidGrant(comments, { codeSha, nowMs, nextSlot }) {
  if (!SHA.test(codeSha ?? '') || !Number.isSafeInteger(nowMs)) return 'STOP';
  if (!Array.isArray(comments) || comments.length > 500) return 'STOP';
  if (!nextSlot || ![1, 2, 3].includes(nextSlot)) return 'STOP';

  const matching = [];
  for (const comment of comments) {
    if (!comment || typeof comment !== 'object') continue;
    // The authenticated GitHub repository-owner association supplies the
    // account identity. Do not pin an unverified numeric GitHub user ID.
    if (comment.user?.login !== OWNER_LOGIN || !Number.isSafeInteger(comment.user?.id)) continue;
    if (comment.author_association !== 'OWNER') continue;
    if (typeof comment.body !== 'string' || comment.body.length > 4096) continue;

    let grant;
    try {
      grant = JSON.parse(comment.body);
    } catch {
      continue;
    }
    const fields = [
      'schemaVersion',
      'kind',
      'repository',
      'issueNumber',
      'codeSha',
      'bookId',
      'slots',
      'maxCalls',
      'maxSpendMinor',
      'noRetry',
      'allowedResource',
      'expiresAt',
    ];
    if (!exactFields(grant, fields)) continue;
    const createdMs = parsedUtc(comment.created_at);
    const expiryMs = parsedUtc(grant.expiresAt);
    if (
      grant.schemaVersion !== I111_OPERATION_GRANT_SCHEMA ||
      grant.kind !== 'I111_PAID_OPERATION_GRANT' ||
      grant.repository !== 'Fredilly/Xiaohai' ||
      grant.issueNumber !== ISSUE_NUMBER ||
      grant.codeSha !== codeSha ||
      grant.bookId !== I111_ONE_SHOT_SCOPE.bookId ||
      !Array.isArray(grant.slots) ||
      grant.slots.length !== 3 ||
      grant.slots[0] !== 1 ||
      grant.slots[1] !== 2 ||
      grant.slots[2] !== 3 ||
      !grant.slots.includes(nextSlot) ||
      grant.maxCalls !== I111_ONE_SHOT_SCOPE.maxCalls ||
      grant.maxSpendMinor !== I111_ONE_SHOT_SCOPE.budgetLimitMinor ||
      grant.noRetry !== true ||
      grant.allowedResource !== 'MAC_GATE_B_FIXED_PLAN_B' ||
      createdMs === null ||
      expiryMs === null ||
      expiryMs <= createdMs ||
      expiryMs - createdMs > ALLOWED_WINDOW_MS ||
      nowMs < createdMs ||
      nowMs >= expiryMs ||
      comment.updated_at !== comment.created_at ||
      !Number.isSafeInteger(comment.id)
    ) {
      continue;
    }
    matching.push(comment.id);
  }

  // Multiple apparently valid comments are ambiguous; never select one.
  return matching.length === 1 ? 'MATCHES_SCHEMA_ONLY' : 'STOP';
}

/**
 * Read ALL current #111 issue comments directly over HTTPS from the fixed
 * GitHub REST endpoint. No operator-supplied URL, account, token or body is
 * accepted. Fetch failures, unexpected data or pagination limits are STOP.
 * This function does not spend, mutate GitHub, or approve itself.
 */
export async function verifyI111PaidGrantFromGitHub({ codeSha, nextSlot }) {
  try {
    const comments = [];
    let serverNowMs = null;
    for (let page = 1; page <= 5; page += 1) {
      const url = `https://api.github.com/repos/Fredilly/Xiaohai/issues/111/comments?per_page=100&page=${page}`;
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'error',
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(7_000),
      });
      if (!response.ok || response.status !== 200 || response.url !== url) return 'STOP';
      // Expiry uses GitHub's HTTPS response clock, not an operator-provided
      // timestamp, fixture clock or local system clock.
      const date = response.headers?.get('date');
      const observedNowMs = typeof date === 'string' ? Date.parse(date) : NaN;
      if (!Number.isFinite(observedNowMs)) return 'STOP';
      if (serverNowMs !== null && Math.abs(observedNowMs - serverNowMs) > 30_000) return 'STOP';
      serverNowMs = observedNowMs;
      const pageComments = await response.json();
      if (!Array.isArray(pageComments) || pageComments.length > 100) return 'STOP';
      for (const comment of pageComments) {
        if (
          !Number.isSafeInteger(comment?.id) ||
          comment.html_url !==
            `https://github.com/Fredilly/Xiaohai/issues/111#issuecomment-${comment.id}`
        ) {
          return 'STOP';
        }
      }
      comments.push(...pageComments);
      if (pageComments.length < 100) {
        return classifyI111PaidGrant(comments, { codeSha, nowMs: serverNowMs, nextSlot }) ===
          'MATCHES_SCHEMA_ONLY'
          ? 'INDEPENDENT_VERIFIED_ONE_TIME_GRANT'
          : 'STOP';
      }
    }
  } catch {
    // Never print the response; authorization failure is always a fixed STOP.
  }
  return 'STOP';
}

/**
 * The exact verifyOwnerOperationGrant port expected by the reviewed #111
 * orchestration contract. Scope mismatch causes STOP before any network I/O.
 * The calling runtime must additionally authenticate checkout/PR provenance,
 * exclusive isolation and the paid boundary; this port proves owner intent
 * only, and it does not authorize any action by itself.
 */
export async function verifyI111OwnerGrantPort(details) {
  const order = [
    { pageId: I111_ONE_SHOT_SCOPE.page1Id, revisionNumber: 1 },
    { pageId: I111_ONE_SHOT_SCOPE.page2Id, revisionNumber: 1 },
    { pageId: I111_ONE_SHOT_SCOPE.page2Id, revisionNumber: 2 },
  ];
  const nextSlot = order.findIndex(
    (item) => item.pageId === details?.pageId && item.revisionNumber === details?.revisionNumber,
  );
  if (
    nextSlot < 0 ||
    details.bookId !== I111_ONE_SHOT_SCOPE.bookId ||
    details.maxCalls !== I111_ONE_SHOT_SCOPE.maxCalls ||
    details.maxSpendMinor !== I111_ONE_SHOT_SCOPE.budgetLimitMinor ||
    !SHA.test(details.exactCodeSha ?? '')
  ) {
    return 'STOP';
  }
  return verifyI111PaidGrantFromGitHub({ codeSha: details.exactCodeSha, nextSlot: nextSlot + 1 });
}
