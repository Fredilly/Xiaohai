import { useState, type FormEvent } from 'react';
import { cmsSectionTypeSchema, type CmsSectionInput } from '@xiaohai/contracts';
import {
  defaultConfigJson,
  parseCmsSectionForm,
  type CmsSectionFormValues,
} from './cms-section-form';
import './cms.css';

const sectionTypes: CmsSectionInput['sectionType'][] = [
  'HERO',
  'FEATURE_GRID',
  'CONTENT_LIST',
  'BANNER',
];

export function CmsSectionEditor({
  initialValues,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  initialValues: CmsSectionFormValues;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (input: CmsSectionInput) => Promise<void>;
}) {
  const [values, setValues] = useState(initialValues);
  const [validationError, setValidationError] = useState('');
  const [saving, setSaving] = useState(false);
  const config = (() => {
    try {
      const parsed: unknown = JSON.parse(values.configJson);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  })();
  const action = (() => {
    try {
      const parsed: unknown = JSON.parse(values.actionJson);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as { target?: string })
        : {};
    } catch {
      return {};
    }
  })();
  const updateConfig = (field: string, value: string) => {
    const next = { ...config, [field]: value };
    if (!value && field === 'eyebrow') delete next[field];
    setValues({ ...values, configJson: JSON.stringify(next, null, 2) });
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationError('');
    let input: CmsSectionInput;
    try {
      input = parseCmsSectionForm(values);
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : '表单内容无效');
      return;
    }
    setSaving(true);
    try {
      await onSubmit(input);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="cms-form" onSubmit={(event) => void submit(event)}>
      <div className="cms-form-grid">
        <label>
          内容类型
          <select
            value={values.sectionType}
            onChange={(event) => {
              const sectionType = cmsSectionTypeSchema.parse(event.target.value);
              setValues({ ...values, sectionType, configJson: defaultConfigJson(sectionType) });
            }}
          >
            {sectionTypes.map((sectionType) => (
              <option key={sectionType} value={sectionType}>
                {sectionType}
              </option>
            ))}
          </select>
        </label>
        <label>
          标题
          <input
            required
            value={values.title}
            onChange={(event) => setValues({ ...values, title: event.target.value })}
          />
        </label>
        <label>
          副标题
          <input
            value={values.subtitle}
            onChange={(event) => setValues({ ...values, subtitle: event.target.value })}
          />
        </label>
        <label>
          显示顺序
          <input
            required
            type="number"
            min="0"
            max="10000"
            value={values.displayOrder}
            onChange={(event) => setValues({ ...values, displayOrder: event.target.value })}
          />
        </label>
        <label>
          发布状态
          <select
            value={values.publicationState}
            onChange={(event) =>
              setValues({
                ...values,
                publicationState: event.target.value === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT',
              })
            }
          >
            <option value="DRAFT">草稿</option>
            <option value="PUBLISHED">已发布</option>
          </select>
        </label>
        <label className="cms-checkbox">
          <input
            type="checkbox"
            checked={values.enabled}
            onChange={(event) => setValues({ ...values, enabled: event.target.checked })}
          />
          启用
        </label>
      </div>
      {values.sectionType === 'HERO' && (
        <label>
          顶部短语（可选）
          <input
            maxLength={80}
            value={typeof config.eyebrow === 'string' ? config.eyebrow : ''}
            onChange={(event) => updateConfig('eyebrow', event.target.value)}
          />
        </label>
      )}
      {values.sectionType === 'BANNER' && (
        <label>
          横幅正文
          <textarea
            required
            maxLength={500}
            rows={3}
            value={typeof config.body === 'string' ? config.body : ''}
            onChange={(event) => updateConfig('body', event.target.value)}
          />
        </label>
      )}
      <label>
        图片地址
        <input
          type="url"
          placeholder="https://…（可选）"
          value={values.mediaUrl}
          onChange={(event) => setValues({ ...values, mediaUrl: event.target.value })}
        />
      </label>
      <label>
        点击后跳转目标（可选）
        <input
          maxLength={64}
          value={action.target ?? ''}
          onChange={(event) =>
            setValues({
              ...values,
              actionJson: event.target.value.trim()
                ? JSON.stringify({ type: 'PREVIEW', target: event.target.value })
                : '',
            })
          }
        />
      </label>
      <details className="advanced-config">
        <summary>高级配置：内容及跳转</summary>
        <p>内容结构与跳转配置需符合当前内容类型要求；请在发布前预览页面。</p>
        <label>
          内容配置 JSON
          <textarea
            required
            rows={8}
            value={values.configJson}
            onChange={(event) => setValues({ ...values, configJson: event.target.value })}
          />
        </label>
        <label>
          跳转配置 JSON（可选）
          <textarea
            rows={4}
            value={values.actionJson}
            onChange={(event) => setValues({ ...values, actionJson: event.target.value })}
          />
        </label>
      </details>
      {validationError && <p className="cms-form-error">{validationError}</p>}
      <div className="cms-form-actions">
        <button type="button" onClick={onCancel} disabled={saving}>
          取消
        </button>
        <button type="submit" disabled={saving}>
          {saving ? '保存中…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
