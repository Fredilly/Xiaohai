import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type {
  AdminContentResponse,
  AdminSeries,
  EpisodeInput,
  MediaInput,
  SeriesInput,
} from '@xiaohai/contracts/content';
import {
  ContentApiError,
  createAdminEpisode,
  createAdminMedia,
  createAdminSeries,
  getAdminContent,
  updateAdminSeries,
} from './content-api';

type LoadState = 'loading' | 'ready' | 'error' | 'unauthorized' | 'forbidden';

const blankSeries: SeriesInput = {
  slug: '',
  title: '',
  description: null,
  category: '',
  coverUrl: null,
  status: 'DRAFT',
};

const blankMedia: MediaInput = {
  provider: 'EXTERNAL',
  objectKey: '',
  playbackUrl: null,
  mimeType: 'video/mp4',
  byteSize: null,
  durationSeconds: null,
  status: 'PENDING',
};

export function ContentManager({ token }: { token: string }) {
  const [data, setData] = useState<AdminContentResponse | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [message, setMessage] = useState('');
  const [seriesEditor, setSeriesEditor] = useState<AdminSeries | 'new' | null>(null);
  const [creatingMedia, setCreatingMedia] = useState(false);
  const [creatingEpisode, setCreatingEpisode] = useState(false);

  const load = useCallback(async () => {
    setState('loading');

    try {
      setData(await getAdminContent(token));
      setState('ready');
    } catch (error) {
      setState(errorState(error));
    }
  }, [token]);

  useEffect(() => void load(), [load]);

  async function mutate(action: () => Promise<unknown>) {
    setMessage('保存中…');

    try {
      await action();
      setMessage('已保存');
      await load();
      return true;
    } catch (error) {
      const next = errorState(error);
      setState(next);
      setMessage(next === 'ready' ? '保存失败' : stateMessage(next));
      return false;
    }
  }

  if (state === 'loading') return <section className="panel">正在加载 M7 动画与媒体内容…</section>;

  if (state === 'unauthorized')
    return <section className="panel">Staff Session 已失效，请重新登录。</section>;

  if (state === 'forbidden')
    return <section className="panel">当前 Staff 没有 content.manage + GLOBAL 权限。</section>;

  if (state === 'error' || !data)
    return (
      <section className="panel">
        <p>内容管理加载失败。</p>
        <button onClick={() => void load()}>重试</button>
      </section>
    );

  return (
    <section className="panel">
      <div className="section-toolbar">
        <div>
          <span className="badge">M7 · Stories & Animation</span>
          <h2>动画 / 内容管理</h2>
          <p>
            Series {data.series.length} · Media {data.media.length}
          </p>
        </div>

        <div className="cms-actions">
          <button onClick={() => setSeriesEditor('new')}>新增 Series</button>
          <button onClick={() => setCreatingEpisode(true)} disabled={data.series.length === 0}>
            新增 Episode
          </button>
          <button onClick={() => setCreatingMedia(true)}>新增 Media</button>
          <button onClick={() => void load()}>刷新</button>
        </div>
      </div>

      <p className="muted">
        当前只登记媒体元数据和播放 URL；不伪造上传、转码、CDN 或签名 URL 能力。
      </p>

      {message && <p role="status">{message}</p>}

      {seriesEditor && (
        <div className="cms-editor-panel">
          <SeriesForm
            initial={seriesEditor === 'new' ? blankSeries : seriesEditor}
            editing={seriesEditor !== 'new'}
            onCancel={() => setSeriesEditor(null)}
            onSave={async (input) => {
              const saved = await mutate(() =>
                seriesEditor === 'new'
                  ? createAdminSeries(token, input)
                  : updateAdminSeries(token, seriesEditor.id, input),
              );

              if (saved) setSeriesEditor(null);
            }}
          />
        </div>
      )}

      {creatingMedia && (
        <div className="cms-editor-panel">
          <MediaForm
            onCancel={() => setCreatingMedia(false)}
            onSave={async (input) => {
              const saved = await mutate(() => createAdminMedia(token, input));
              if (saved) setCreatingMedia(false);
            }}
          />
        </div>
      )}

      {creatingEpisode && (
        <div className="cms-editor-panel">
          <EpisodeForm
            series={data.series}
            media={data.media}
            onCancel={() => setCreatingEpisode(false)}
            onSave={async (input) => {
              const saved = await mutate(() => createAdminEpisode(token, input));
              if (saved) setCreatingEpisode(false);
            }}
          />
        </div>
      )}

      <h3>Series</h3>

      {data.series.length === 0 ? (
        <div className="empty-state">暂无 Series，可先创建一个 DRAFT。</div>
      ) : (
        <div className="cms-list">
          {data.series.map((series) => (
            <article className="cms-row" key={series.id}>
              <div>
                <strong>{series.title}</strong>
                <span>
                  {series.slug} · {series.category}
                </span>
              </div>
              <span>{series.status}</span>
              <button onClick={() => setSeriesEditor(series)}>编辑</button>
            </article>
          ))}
        </div>
      )}

      <h3>Media</h3>

      {data.media.length === 0 ? (
        <div className="empty-state">暂无 Media metadata。</div>
      ) : (
        <div className="cms-list">
          {data.media.map((media) => (
            <article className="cms-row" key={media.id}>
              <div>
                <strong>{media.objectKey}</strong>
                <span>
                  {media.provider} · {media.mimeType}
                  {media.durationSeconds === null ? '' : ` · ${media.durationSeconds}s`}
                </span>
              </div>
              <span>{media.status}</span>
              <span>{media.playbackUrl ? '已有播放 URL' : '无播放 URL'}</span>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function SeriesForm({
  initial,
  editing,
  onCancel,
  onSave,
}: {
  initial: SeriesInput;
  editing: boolean;
  onCancel: () => void;
  onSave: (input: SeriesInput) => Promise<void>;
}) {
  const [value, setValue] = useState<SeriesInput>({
    slug: initial.slug,
    title: initial.title,
    description: initial.description,
    category: initial.category,
    coverUrl: initial.coverUrl,
    status: initial.status,
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);

    try {
      await onSave(value);
    } catch {
      setError('保存失败，请检查字段、slug 冲突或权限。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="cms-form" onSubmit={(event) => void submit(event)}>
      <h3>{editing ? '编辑 Series' : '新增 Series'}</h3>

      <label>
        Slug
        <input
          required
          value={value.slug}
          onChange={(event) => setValue({ ...value, slug: event.target.value })}
        />
      </label>

      <label>
        标题
        <input
          required
          value={value.title}
          onChange={(event) => setValue({ ...value, title: event.target.value })}
        />
      </label>

      <label>
        简介
        <textarea
          value={value.description ?? ''}
          onChange={(event) => setValue({ ...value, description: event.target.value || null })}
        />
      </label>

      <label>
        Category
        <input
          required
          value={value.category}
          onChange={(event) => setValue({ ...value, category: event.target.value })}
        />
      </label>

      <label>
        Cover URL
        <input
          type="url"
          value={value.coverUrl ?? ''}
          onChange={(event) => setValue({ ...value, coverUrl: event.target.value || null })}
        />
      </label>

      <label>
        发布状态
        <select
          value={value.status}
          onChange={(event) =>
            setValue({
              ...value,
              status:
                event.target.value === 'PUBLISHED'
                  ? 'PUBLISHED'
                  : event.target.value === 'UNPUBLISHED'
                    ? 'UNPUBLISHED'
                    : 'DRAFT',
            })
          }
        >
          <option value="DRAFT">DRAFT</option>
          <option value="PUBLISHED">PUBLISHED</option>
          <option value="UNPUBLISHED">UNPUBLISHED</option>
        </select>
      </label>

      {error && <p className="cms-form-error">{error}</p>}

      <div className="cms-form-actions">
        <button type="button" onClick={onCancel} disabled={busy}>
          取消
        </button>
        <button type="submit" disabled={busy}>
          {busy ? '保存中…' : '保存 Series'}
        </button>
      </div>
    </form>
  );
}

function MediaForm({
  onCancel,
  onSave,
}: {
  onCancel: () => void;
  onSave: (input: MediaInput) => Promise<void>;
}) {
  const [value, setValue] = useState<MediaInput>(blankMedia);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);

    try {
      await onSave(value);
    } catch {
      setError('保存失败，请检查 object key、URL、数字字段或权限。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="cms-form" onSubmit={(event) => void submit(event)}>
      <h3>新增 Media metadata</h3>

      <label>
        Provider
        <input
          required
          value={value.provider}
          onChange={(event) => setValue({ ...value, provider: event.target.value })}
        />
      </label>

      <label>
        Object key
        <input
          required
          value={value.objectKey}
          onChange={(event) => setValue({ ...value, objectKey: event.target.value })}
        />
      </label>

      <label>
        Playback URL
        <input
          type="url"
          value={value.playbackUrl ?? ''}
          onChange={(event) => setValue({ ...value, playbackUrl: event.target.value || null })}
        />
      </label>

      <label>
        MIME type
        <input
          required
          value={value.mimeType}
          onChange={(event) => setValue({ ...value, mimeType: event.target.value })}
        />
      </label>

      <label>
        Byte size
        <input
          type="number"
          min="0"
          value={value.byteSize ?? ''}
          onChange={(event) =>
            setValue({
              ...value,
              byteSize: event.target.value === '' ? null : Number(event.target.value),
            })
          }
        />
      </label>

      <label>
        Duration seconds
        <input
          type="number"
          min="0"
          value={value.durationSeconds ?? ''}
          onChange={(event) =>
            setValue({
              ...value,
              durationSeconds: event.target.value === '' ? null : Number(event.target.value),
            })
          }
        />
      </label>

      <label>
        状态
        <select
          value={value.status}
          onChange={(event) =>
            setValue({
              ...value,
              status:
                event.target.value === 'READY'
                  ? 'READY'
                  : event.target.value === 'DISABLED'
                    ? 'DISABLED'
                    : 'PENDING',
            })
          }
        >
          <option value="PENDING">PENDING</option>
          <option value="READY">READY</option>
          <option value="DISABLED">DISABLED</option>
        </select>
      </label>

      {error && <p className="cms-form-error">{error}</p>}

      <div className="cms-form-actions">
        <button type="button" onClick={onCancel} disabled={busy}>
          取消
        </button>
        <button type="submit" disabled={busy}>
          {busy ? '保存中…' : '创建 Media'}
        </button>
      </div>
    </form>
  );
}

function EpisodeForm({
  series,
  media,
  onCancel,
  onSave,
}: {
  series: AdminContentResponse['series'];
  media: AdminContentResponse['media'];
  onCancel: () => void;
  onSave: (input: EpisodeInput) => Promise<void>;
}) {
  const [value, setValue] = useState<EpisodeInput>({
    seriesId: series[0]?.id ?? '',
    mediaAssetId: null,
    episodeNumber: 1,
    title: '',
    description: null,
    accessMode: 'FREE',
    previewSeconds: null,
    status: 'DRAFT',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    if (!value.seriesId) {
      setError('请先选择 Series。');
      return;
    }

    if (value.accessMode === 'PREVIEW' && !value.previewSeconds) {
      setError('PREVIEW 必须填写 previewSeconds。');
      return;
    }

    setBusy(true);

    try {
      await onSave(value);
    } catch {
      setError('保存失败，请检查集数冲突、媒体引用、字段或权限。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="cms-form" onSubmit={(event) => void submit(event)}>
      <h3>新增 Episode</h3>

      <label>
        Series
        <select
          required
          value={value.seriesId}
          onChange={(event) => setValue({ ...value, seriesId: event.target.value })}
        >
          {series.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title} · {item.status}
            </option>
          ))}
        </select>
      </label>

      <label>
        Episode number
        <input
          required
          type="number"
          min="1"
          value={value.episodeNumber}
          onChange={(event) => setValue({ ...value, episodeNumber: Number(event.target.value) })}
        />
      </label>

      <label>
        标题
        <input
          required
          value={value.title}
          onChange={(event) => setValue({ ...value, title: event.target.value })}
        />
      </label>

      <label>
        简介
        <textarea
          value={value.description ?? ''}
          onChange={(event) => setValue({ ...value, description: event.target.value || null })}
        />
      </label>

      <label>
        Media
        <select
          value={value.mediaAssetId ?? ''}
          onChange={(event) => setValue({ ...value, mediaAssetId: event.target.value || null })}
        >
          <option value="">暂不绑定 Media</option>
          {media.map((item) => (
            <option key={item.id} value={item.id}>
              {item.objectKey} · {item.status}
            </option>
          ))}
        </select>
      </label>

      <label>
        Access mode
        <select
          value={value.accessMode}
          onChange={(event) => {
            const accessMode =
              event.target.value === 'PAID'
                ? 'PAID'
                : event.target.value === 'PREVIEW'
                  ? 'PREVIEW'
                  : 'FREE';

            setValue({
              ...value,
              accessMode,
              previewSeconds: accessMode === 'PREVIEW' ? value.previewSeconds : null,
            });
          }}
        >
          <option value="FREE">FREE</option>
          <option value="PREVIEW">PREVIEW</option>
          <option value="PAID">PAID</option>
        </select>
      </label>

      {value.accessMode === 'PREVIEW' && (
        <label>
          Preview seconds
          <input
            required
            type="number"
            min="1"
            value={value.previewSeconds ?? ''}
            onChange={(event) =>
              setValue({
                ...value,
                previewSeconds: event.target.value === '' ? null : Number(event.target.value),
              })
            }
          />
        </label>
      )}

      <label>
        发布状态
        <select
          value={value.status}
          onChange={(event) =>
            setValue({
              ...value,
              status:
                event.target.value === 'PUBLISHED'
                  ? 'PUBLISHED'
                  : event.target.value === 'UNPUBLISHED'
                    ? 'UNPUBLISHED'
                    : 'DRAFT',
            })
          }
        >
          <option value="DRAFT">DRAFT</option>
          <option value="PUBLISHED">PUBLISHED</option>
          <option value="UNPUBLISHED">UNPUBLISHED</option>
        </select>
      </label>

      {error && <p className="cms-form-error">{error}</p>}

      <div className="cms-form-actions">
        <button type="button" onClick={onCancel} disabled={busy}>
          取消
        </button>
        <button type="submit" disabled={busy}>
          {busy ? '保存中…' : '创建 Episode'}
        </button>
      </div>
    </form>
  );
}

function errorState(error: unknown): LoadState {
  if (!(error instanceof ContentApiError)) return 'error';
  if (error.status === 401) return 'unauthorized';
  if (error.status === 403) return 'forbidden';
  return 'error';
}

function stateMessage(state: LoadState): string {
  if (state === 'unauthorized') return 'Staff Session 已失效。';
  if (state === 'forbidden') return '缺少 content.manage + GLOBAL 权限。';
  return '保存失败。';
}
