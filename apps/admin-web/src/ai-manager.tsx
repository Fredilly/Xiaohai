import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { AiJob } from '@xiaohai/contracts/ai';
import { AiApiError, cancelAiJob, enqueueAiJob, listAiJobs, retryAiJob } from './ai-api';
import { displayStatus } from './display';
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
          ? '当前账号没有 AI 作业管理权限。'
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
      setMessage('作业已提交，请刷新查看进度。');
      await load();
      event.currentTarget.reset();
    } catch {
      setMessage('提交失败，请检查输入或稍后重试。');
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
          <span className="badge">作业管理</span>
          <h2>AI 作业监控</h2>
        </div>
        <button onClick={() => void load()}>刷新</button>
      </div>
      <p className="muted">此处用于平台作业诊断；故事、绘本与动画作品请在各自的业务流程中管理。</p>
      <form className="cms-form" onSubmit={(event) => void submit(event)}>
        <label>
          项目标题
          <input name="title" required maxLength={120} />
        </label>
        <label>
          服务提供方
          <select name="provider">
            <option value="MOCK">测试服务（仅测试环境可用）</option>
            <option value="DEEPSEEK">DEEPSEEK</option>
          </select>
        </label>
        <label>
          模型
          <input name="model" required defaultValue="deepseek-chat" maxLength={120} />
        </label>
        <label>
          测试内容
          <textarea name="prompt" required maxLength={20000} />
        </label>
        <button disabled={busy}>提交作业</button>
      </form>
      <p role="status">{message}</p>
      <div className="cms-list">
        {jobs.map((job) => (
          <article className="cms-row" key={job.id}>
            <div>
              <strong>{job.projectTitle}</strong>
              <span>
                {job.provider === 'MOCK' ? '测试服务' : job.provider} · {job.model} · 重试{' '}
                {job.attemptCount}/{job.maxAttempts}
              </span>
              <span>
                审核：{job.moderation?.input ?? '待处理'} / {job.moderation?.output ?? '待处理'}
              </span>
            </div>
            <span className="badge">{displayStatus(job.status)}</span>
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
