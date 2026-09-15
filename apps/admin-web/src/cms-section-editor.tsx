import { useState, type FormEvent } from 'react';
import type { CmsSectionInput } from '@xiaohai/contracts';
import {
  defaultConfigJson,
  parseCmsSectionForm,
  type CmsSectionFormValues,
} from './cms-section-form';

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
          Section 类型
          <select
            value={values.sectionType}
            onChange={(event) => {
              const sectionType = event.target.value as CmsSectionInput['sectionType'];
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
          Display order
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
            <option value="DRAFT">DRAFT</option>
            <option value="PUBLISHED">PUBLISHED</option>
          </select>
        </label>
        <label className="cms-checkbox">
          <input
            type="checkbox"
            checked={values.enabled}
            onChange={(event) => setValues({ ...values, enabled: event.target.checked })}
          />
          Enabled
        </label>
      </div>
      <label>
        Config JSON
        <textarea
          required
          rows={8}
          value={values.configJson}
          onChange={(event) => setValues({ ...values, configJson: event.target.value })}
        />
        <small>按当前 Section type 的共享 Zod contract 校验；无效 JSON 不会提交。</small>
      </label>
      <label>
        Media URL
        <input
          type="url"
          placeholder="https://…（可选）"
          value={values.mediaUrl}
          onChange={(event) => setValues({ ...values, mediaUrl: event.target.value })}
        />
      </label>
      <label>
        Action JSON
        <textarea
          rows={4}
          placeholder={'可选，例如 {"type":"PREVIEW","target":"shop"}'}
          value={values.actionJson}
          onChange={(event) => setValues({ ...values, actionJson: event.target.value })}
        />
        <small>当前 contract 仅接受受控 PREVIEW action；留空表示无导航动作。</small>
      </label>
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
