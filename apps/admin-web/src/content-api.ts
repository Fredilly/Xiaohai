import {
  adminContentResponseSchema,
  adminEpisodeSchema,
  adminMediaSchema,
  adminSeriesSchema,
  episodeInputSchema,
  mediaInputSchema,
  seriesInputSchema,
  type AdminContentResponse,
  type AdminEpisode,
  type AdminMedia,
  type AdminSeries,
  type EpisodeInput,
  type MediaInput,
  type SeriesInput,
} from '@xiaohai/contracts/content';

const configuredBase: unknown = import.meta.env.VITE_API_BASE_URL;
const base = typeof configuredBase === 'string' ? configuredBase : 'http://127.0.0.1:3000';

export class ContentApiError extends Error {
  constructor(readonly status: number) {
    super(`Content API ${status}`);
  }
}

async function call(path: string, token: string, method = 'GET', body?: unknown): Promise<unknown> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (!response.ok) throw new ContentApiError(response.status);
  return response.json() as Promise<unknown>;
}

export async function getAdminContent(token: string): Promise<AdminContentResponse> {
  return adminContentResponseSchema.parse(await call('/api/v1/staff/content', token));
}

export async function createAdminSeries(token: string, input: SeriesInput): Promise<AdminSeries> {
  const validated = seriesInputSchema.parse(input);
  return adminSeriesSchema.parse(
    await call('/api/v1/staff/content/series', token, 'POST', validated),
  );
}

export async function updateAdminSeries(
  token: string,
  id: string,
  input: SeriesInput,
): Promise<AdminSeries> {
  const validated = seriesInputSchema.parse(input);
  return adminSeriesSchema.parse(
    await call(`/api/v1/staff/content/series/${id}`, token, 'PUT', validated),
  );
}

export async function createAdminMedia(token: string, input: MediaInput): Promise<AdminMedia> {
  const validated = mediaInputSchema.parse(input);
  return adminMediaSchema.parse(
    await call('/api/v1/staff/content/media', token, 'POST', validated),
  );
}

export async function createAdminEpisode(
  token: string,
  input: EpisodeInput,
): Promise<AdminEpisode> {
  const validated = episodeInputSchema.parse(input);
  return adminEpisodeSchema.parse(
    await call('/api/v1/staff/content/episodes', token, 'POST', validated),
  );
}
