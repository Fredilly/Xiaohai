import { useCallback, useEffect, useState } from 'react';
import type { AdminHomeResponse, CmsSection, CmsSectionInput } from '@xiaohai/contracts';
import {
  CmsApiError,
  createCmsSection,
  getCmsHome,
  reorderCmsSections,
  updateCmsPublication,
  updateCmsSection,
} from './cms-api';
import { CmsSectionEditor } from './cms-section-editor';
import { formValuesFromSection, newSectionFormValues } from './cms-section-form';
import { displayStatus } from './display';

export function CmsManager({ token }: { token: string }) {
  const [home, setHome] = useState<AdminHomeResponse | null>(null);
  const [state, setState] = useState<
    'loading' | 'ready' | 'error' | 'unauthorized' | 'forbidden' | 'conflict'
  >('loading');
  const [message, setMessage] = useState('');
  const [editor, setEditor] = useState<CmsSection | 'new' | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      setHome(await getCmsHome(token));
      setState('ready');
    } catch (error) {
      setState(errorState(error));
    }
  }, [token]);

  useEffect(() => void load(), [load]);

  async function mutate(action: () => Promise<unknown>): Promise<boolean> {
    setMessage('保存中…');
    try {
      await action();
      setMessage('已保存');
      await load();
      return true;
    } catch (error) {
      const next = errorState(error);
      setState(next);
      setMessage(next === 'conflict' ? '内容已被其他管理员修改，请重新加载后再编辑。' : '保存失败');
      return false;
    }
  }

  if (state === 'loading') return <section className="panel">正在加载首页内容…</section>;
  if (state === 'unauthorized')
    return <section className="panel">登录状态已失效，请重新登录。</section>;
  if (state === 'forbidden')
    return <section className="panel">当前账号没有首页内容管理权限。</section>;
  if (state === 'conflict')
    return (
      <section className="panel">
        <p>检测到并发修改，未覆盖他人内容。</p>
        <button onClick={() => void load()}>重新加载</button>
      </section>
    );
  if (state === 'error' || !home)
    return (
      <section className="panel">
        <p>首页内容加载失败。</p>
        <button onClick={() => void load()}>重试</button>
      </section>
    );

  const sorted = [...home.sections].sort((a, b) => a.displayOrder - b.displayOrder);
  const editingSection = editor === 'new' ? null : editor;
  return (
    <section className="panel">
      <div className="section-toolbar">
        <div>
          <h2>首页内容</h2>
          <p>页面状态：{displayStatus(home.page.publicationState)}</p>
        </div>
        <div className="cms-actions">
          <button
            onClick={() =>
              window.confirm(
                home.page.publicationState === 'PUBLISHED'
                  ? '确定取消发布首页？'
                  : '确定发布首页？',
              ) &&
              void mutate(() =>
                updateCmsPublication(
                  token,
                  home.page.publicationState === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED',
                  home.page.version,
                ),
              )
            }
          >
            {home.page.publicationState === 'PUBLISHED' ? '取消发布首页' : '发布首页'}
          </button>
          <button onClick={() => setEditor('new')}>新增内容区</button>
        </div>
      </div>
      {message && <p role="status">{message}</p>}
      {editor && (
        <div className="cms-editor-panel">
          <h3>{editor === 'new' ? '新增内容区' : `编辑：${editor.title}`}</h3>
          <CmsSectionEditor
            key={editor === 'new' ? `new-${nextOrder(sorted)}` : editor.id}
            initialValues={
              editor === 'new'
                ? newSectionFormValues(nextOrder(sorted))
                : formValuesFromSection(editor)
            }
            submitLabel={editor === 'new' ? '创建内容区' : '保存内容区'}
            onCancel={() => setEditor(null)}
            onSubmit={(input) => saveEditor(input, editingSection)}
          />
        </div>
      )}
      {sorted.length === 0 ? (
        <div className="empty-state">暂无内容区，可先新增一个草稿运营位。</div>
      ) : (
        <div className="cms-list">
          {sorted.map((section, index) => (
            <article className="cms-row" key={section.id}>
              <div>
                <strong>{section.title}</strong>
                <span>
                  {section.sectionType} · 排序 {section.displayOrder}
                </span>
              </div>
              <div>
                <span>
                  {section.enabled ? '启用' : '停用'} · {displayStatus(section.publicationState)}
                </span>
              </div>
              <div className="cms-actions">
                <button onClick={() => setEditor(section)}>编辑</button>
                <button
                  onClick={() =>
                    window.confirm(
                      section.enabled ? '确定停用这个内容区？' : '确定启用这个内容区？',
                    ) &&
                    void mutate(() =>
                      updateCmsSection(token, section.id, {
                        version: section.version,
                        enabled: !section.enabled,
                      }),
                    )
                  }
                >
                  {section.enabled ? '停用' : '启用'}
                </button>
                <button
                  onClick={() =>
                    window.confirm(
                      section.publicationState === 'PUBLISHED' ? '确定取消发布？' : '确定发布？',
                    ) &&
                    void mutate(() =>
                      updateCmsSection(token, section.id, {
                        version: section.version,
                        publicationState:
                          section.publicationState === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED',
                      }),
                    )
                  }
                >
                  {section.publicationState === 'PUBLISHED' ? '取消发布' : '发布'}
                </button>
                <button disabled={index === 0} onClick={() => void move(index, -1)}>
                  上移
                </button>
                <button disabled={index === sorted.length - 1} onClick={() => void move(index, 1)}>
                  下移
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );

  async function saveEditor(input: CmsSectionInput, section: CmsSection | null): Promise<void> {
    const saved = await mutate(() =>
      section
        ? updateCmsSection(token, section.id, { ...input, version: section.version })
        : createCmsSection(token, input),
    );
    if (saved) setEditor(null);
  }

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= sorted.length) return;
    const reordered = [...sorted];
    [reordered[index], reordered[target]] = [reordered[target]!, reordered[index]!];
    await mutate(() =>
      reorderCmsSections(token, {
        items: reordered.map((section, order) => ({
          id: section.id,
          version: section.version,
          displayOrder: order,
        })),
      }),
    );
  }
}

function nextOrder(sections: CmsSection[]): number {
  return sections.length ? Math.max(...sections.map((section) => section.displayOrder)) + 1 : 0;
}

function errorState(error: unknown): 'error' | 'unauthorized' | 'forbidden' | 'conflict' {
  if (!(error instanceof CmsApiError)) return 'error';
  if (error.status === 401) return 'unauthorized';
  if (error.status === 403) return 'forbidden';
  if (error.status === 409) return 'conflict';
  return 'error';
}
