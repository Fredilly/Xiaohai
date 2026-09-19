import { publicInventorySearchResponseSchema } from '@xiaohai/contracts/inventory';

const env = import.meta.env as { readonly VITE_API_BASE_URL?: unknown };
const base =
  typeof env.VITE_API_BASE_URL === 'string' ? env.VITE_API_BASE_URL : 'http://127.0.0.1:3000';

export async function searchStoreBooks(storeId: string, query: string) {
  const params = new URLSearchParams({
    storeId,
    availability: 'ANY',
    limit: '100',
  });
  const normalizedQuery = query.trim();
  if (normalizedQuery) params.set('q', normalizedQuery);

  const response = await fetch(`${base}/api/v1/inventory/books?${params.toString()}`);
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { code?: string };
    } | null;
    throw new Error(payload?.error?.code ?? `HTTP_${response.status}`);
  }
  return publicInventorySearchResponseSchema.parse(await response.json());
}
