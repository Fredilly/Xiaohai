import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { AiJob } from '@xiaohai/contracts/ai';
import { AiApiError, cancelAiJob, enqueueAiJob, listAiJobs, retryAiJob } from './ai-api';
export function AiManager({ token }: { token: string }) {
  const [jobs, setJobs] = useState<AiJob[]>([]),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setJobs((await listAiJobs(token)).jobs);
    } catch (error) {
      setMessage(
        error instanceof AiApiError && error.status === 403
          ? '需要 ai.manage + GLOBAL 权限。'
          : 'AI 作业加载失败。',
      );
    }
  }, [token]);
  useEffect(() => void load(), [load]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      await enqueueAiJob(token, {
        projectTitle: data.get('title'),
        prompt: data.get('prompt'),
        provider: data.get('provider'),
        model: data.get('model'),
        timeoutMs: 30000,
        maxAttempts: 3,
      });
      setMessage('已入队；刷新查看 worker 状态。');
      await load();
      event.currentTarget.reset();
    } catch {
      setMessage('入队失败，请检查权限、Redis、字段或 Provider 配置。');
    } finally {
      setBusy(false);
    }
  }
  async function action(job: AiJob, actionName: 'cancel' | 'retry') {
    setBusy(true);
    try {
      await (actionName === 'cancel' ? cancelAiJob(token, job.id) : retryAiJob(token, job.id));
      await load();
    } catch {
      setMessage('状态转换失败，请刷新确认当前状态。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="section-toolbar">
        <div>
          <span className="badge">M8 · AI Platform</span>
          <h2>AI 作业监控</h2>
        </div>
        <button onClick={() => void load()}>刷新</button>
      </div>
      <p className="muted">
        仅平台通用文本探针；不是 M9 故事、M10 绘本或 M11 动画流程。Prompt 发送至选定服务端
        Provider。
      </p>
      <form className="cms-form" onSubmit={(event) => void submit(event)}>
        <label>
          项目标题
          <input name="title" required maxLength={120} />
        </label>
        <label>
          Provider
          <select name="provider">
            <option value="MOCK">MOCK（仅开发/测试启用）</option>
            <option value="DEEPSEEK">DEEPSEEK</option>
          </select>
        </label>
        <label>
          Model
          <input name="model" required defaultValue="deepseek-chat" maxLength={120} />
        </label>
        <label>
          平台探针输入
          <textarea name="prompt" required maxLength={20000} />
        </label>
        <button disabled={busy}>入队</button>
      </form>
      <p role="status">{message}</p>
      <div className="cms-list">
        {jobs.map((job) => (
          <article className="cms-row" key={job.id}>
            <div>
              <strong>{job.projectTitle}</strong>
              <span>
                {job.provider} · {job.model} · attempts {job.attemptCount}/{job.maxAttempts}
              </span>
              <span>
                moderation {job.moderation?.input ?? 'pending'} /{' '}
                {job.moderation?.output ?? 'pending'} · tokens {job.usage?.totalTokens ?? 'n/a'}
              </span>
            </div>
            <span>{job.status}</span>
            <button
              disabled={busy || !['QUEUED', 'RUNNING'].includes(job.status)}
              onClick={() => void action(job, 'cancel')}
            >
              取消
            </button>
            <button
              disabled={busy || job.status !== 'FAILED'}
              onClick={() => void action(job, 'retry')}
            >
              重试
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
