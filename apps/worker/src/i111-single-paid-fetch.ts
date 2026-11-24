import { I111_PAID_RUN } from './i111-paid-attempt-gate.js';

/** One-use HTTP transport, for a separately authorized #111-only Worker. */
const STOP_CODE = 'I111_IMAGE_TRANSPORT_STOP';
const BOS_BUCKET = 'xiaohai-i111-work-2ec3900280';
const BOS_ENDPOINT = 'cd.bcebos.com';
const BOS_ORIGIN = `${BOS_BUCKET}.${BOS_ENDPOINT}`;

class Stop extends Error {
  constructor() {
    super(STOP_CODE);
  }
}

function exactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function trustedUrl(value: string, hosts: string[]): URL | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      !hosts.includes(url.hostname) ||
      url.username ||
      url.password ||
      url.hash ||
      url.port
    )
      return null;
    return url;
  } catch {
    return null;
  }
}

function referenceKey(value: string): string | null {
  const url = trustedUrl(value, [BOS_ORIGIN, BOS_ENDPOINT]);
  if (!url || !url.search) return null;
  const prefix = `/${BOS_BUCKET}/`;
  const key = url.pathname.startsWith(prefix)
    ? url.pathname.slice(prefix.length)
    : url.pathname.slice(1);
  if (
    !key.startsWith('picture-books/character-references/') ||
    !/^[A-Za-z0-9_/%.-]+\.png$/u.test(key) ||
    key.split('/').some((segment) => segment === '.' || segment === '..' || segment === '')
  )
    return null;
  return key;
}

function trustedDownloadUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.hostname !== 'aliyuncs.com' &&
      url.hostname.endsWith('.aliyuncs.com') &&
      trustedUrl(value, [url.hostname]) !== null
    );
  } catch {
    return false;
  }
}

function validPaidRequest(url: RequestInfo | URL, init: RequestInit | undefined, endpoint: string) {
  if (url !== endpoint || !init || init.method !== 'POST') return false;
  if (typeof init.body !== 'string' || init.body.length > 100_000) return false;
  try {
    const payload: unknown = JSON.parse(init.body);
    if (!exactKeys(payload, ['model', 'prompt', 'image', 'n', 'size'])) return false;
    if (
      payload.model !== I111_PAID_RUN.model ||
      typeof payload.prompt !== 'string' ||
      payload.prompt.length === 0 ||
      payload.n !== 1 ||
      payload.size !== '1024x1024' ||
      !Array.isArray(payload.image) ||
      payload.image.length !== 2
    )
      return false;
    const keys = payload.image.map((value: unknown) =>
      typeof value === 'string' ? referenceKey(value) : null,
    );
    return keys[0] !== null && keys[1] !== null && keys[0] !== keys[1];
  } catch {
    return false;
  }
}

/**
 * Consumes the sole paid POST allowance BEFORE any network I/O, even when the
 * response is unknowable. Enforces one temporary image GET and no redirects.
 *
 * This in-process guard does not prove source provenance, owner approval,
 * atomic isolation, lack of SDK internal retries, or invoice reconciliation.
 * No runnable CLI or paid authorization is supplied by this module.
 */
export function createI111SinglePaidFetch(options: {
  fetcher: typeof fetch;
  workspaceId: string;
}): {
  fetcher: typeof fetch;
  usageSummary: () => Readonly<{
    paidPostConsumed: boolean;
    paidPostSucceeded: boolean;
    imageDownloadConsumed: boolean;
    paidExecutionAuthorized: false;
  }>;
} {
  const { fetcher, workspaceId } = options;
  if (typeof fetcher !== 'function' || !/^ws-[a-z0-9]{8,64}$/u.test(workspaceId)) throw new Stop();

  const endpoint = `https://${workspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/images/generations`;
  let postConsumed = false;
  let postSucceeded = false;
  let getConsumed = false;
  let stopped = false;
  const stop = (): never => {
    stopped = true;
    throw new Stop();
  };

  const guardedFetch: typeof fetch = async (url, init) => {
    if (stopped) stop();
    if (!postConsumed) {
      if (!validPaidRequest(url, init, endpoint)) stop();
      postConsumed = true;
      try {
        const response = await fetcher(url, { ...init, redirect: 'error' });
        postSucceeded = response instanceof Response && response.ok && !response.redirected;
        if (!(response instanceof Response) || response.redirected) stop();
        return response;
      } catch {
        return stop();
      }
    }

    if (
      !postSucceeded ||
      getConsumed ||
      typeof url !== 'string' ||
      !init ||
      (init.method !== undefined && init.method !== 'GET') ||
      init.redirect !== 'error' ||
      !trustedDownloadUrl(url)
    )
      stop();

    getConsumed = true;
    try {
      const response = await fetcher(url, init);
      if (!(response instanceof Response) || response.redirected) stop();
      return response;
    } catch {
      return stop();
    }
  };

  return Object.freeze({
    fetcher: guardedFetch,
    usageSummary: () =>
      Object.freeze({
        paidPostConsumed: postConsumed,
        paidPostSucceeded: postSucceeded,
        imageDownloadConsumed: getConsumed,
        paidExecutionAuthorized: false as const,
      }),
  });
}
