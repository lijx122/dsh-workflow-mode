/**
 * M3 单测：会话执行器 —— mock sessions 全链路、豁免成对登记、
 * pendingInteraction 探测、human 超时/审批路径。
 */
import { describe, it, expect } from 'vitest';
import type { WorkflowNode } from '@dsh-workflow/schema';
import { isExempt } from '../preset-gate.js';
import {
  collectText,
  createMockSessions,
  probePendingInteraction,
  runSessionNode,
  runHumanNode,
} from './session-executor.js';

function nd(id: string, type: string, extra: Record<string, unknown> = {}): WorkflowNode {
  return { id, type, ...extra } as unknown as WorkflowNode;
}

const signal = new AbortController().signal;

describe('mock 会话驱动 llm 全链路', () => {
  it('createSession → addExempt → prompt → 回收 text/result → removeExempt', async () => {
    const sessions = createMockSessions();
    sessions.queueReply('模型回答 ABC');
    const logs: string[] = [];
    const outcome = await runSessionNode(sessions, {
      node: nd('a1', 'llm', { prompt: '问' }),
      prompt: '完整提示词',
      signal,
      onLog: (m) => logs.push(m),
    });
    expect(outcome.outputs.text).toBe('模型回答 ABC');
    expect(outcome.outputs.result).toBe('模型回答 ABC');
    expect(sessions.created).toEqual([
      { workspaceId: 'workflow-run', preset: 'standard', sessionId: 'mock-session-1' },
    ]);
    expect(sessions.prompts.get('mock-session-1')).toEqual(['完整提示词']);
    // 豁免成对：结束后不再处于豁免集合
    expect(isExempt('mock-session-1')).toBe(false);
    expect(logs.some((l) => l.includes('已创建并登记豁免'))).toBe(true);
  });

  it('outputSchema 存在时 result 为解析后的 JSON（lenient）', async () => {
    const sessions = createMockSessions();
    sessions.queueReply('{"riskLevel":"HIGH"}');
    const outcome = await runSessionNode(sessions, {
      node: nd('audit', 'llm', { outputSchema: { type: 'object' } }),
      prompt: 'p',
      signal,
    });
    expect(outcome.outputs.result).toEqual({ riskLevel: 'HIGH' });
    expect(outcome.outputs.text).toBe('{"riskLevel":"HIGH"}');
  });

  it('subagent：preset 透传、workspaceId 派生、result=text', async () => {
    const sessions = createMockSessions();
    sessions.queueReply('任务完成');
    const outcome = await runSessionNode(sessions, {
      node: nd('w1', 'subagent', { preset: 'reviewer' }),
      prompt: '做点事',
      signal,
    });
    expect(sessions.created[0]).toMatchObject({ preset: 'reviewer', workspaceId: 'subagent:w1' });
    expect(outcome.outputs.result).toBe('任务完成');
  });

  it('prompt 投递失败：错误上抛且豁免被移除', async () => {
    const sessions = createMockSessions();
    sessions.failNextPrompt('上游 502');
    await expect(
      runSessionNode(sessions, { node: nd('a2', 'llm'), prompt: 'x', signal }),
    ).rejects.toThrow(/上游 502/);
    expect(isExempt('mock-session-1')).toBe(false);
  });

  it('createSession 失败：带节点 id 的可读错误', async () => {
    const sessions = createMockSessions();
    (sessions as unknown as { createSession: () => Promise<never> }).createSession = async () => {
      throw new Error('runtime down');
    };
    await expect(
      runSessionNode(sessions, { node: nd('a3', 'llm'), prompt: 'x', signal }),
    ).rejects.toThrow(/"a3".*runtime down/s);
  });

  it('派发前已中止：拒绝创建会话', async () => {
    const sessions = createMockSessions();
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      runSessionNode(sessions, { node: nd('a4', 'llm'), prompt: 'x', signal: ctrl.signal }),
    ).rejects.toThrow(/中止/);
    expect(sessions.created).toHaveLength(0);
  });
});

describe('collectText 与探测', () => {
  it('回收最后一轮 assistant 文本；无记录返回空串', () => {
    expect(
      collectText({
        chat: {
          messages: [
            { role: 'user', content: 'q' },
            { role: 'assistant', content: 'a1' },
            { role: 'user', content: 'q2' },
            { role: 'assistant', content: 'a2' },
          ],
        },
      }),
    ).toBe('a2');
    expect(collectText(undefined)).toBe('');
    expect(collectText({ chat: { messages: [] } })).toBe('');
    expect(collectText({})).toBe('');
  });

  it('pendingInteraction：缺席/异常视为不可用，命中 id 视为可用', () => {
    expect(probePendingInteraction(undefined)).toEqual({ available: false });
    expect(probePendingInteraction({})).toEqual({ available: false });
    expect(probePendingInteraction(null)).toEqual({ available: false });
    expect(probePendingInteraction({ pendingInteraction: { id: 'ix-1' } })).toEqual({
      available: true,
      interactionId: 'ix-1',
    });
    expect(probePendingInteraction({ ui: { pendingInteractions: [{ id: 'ix-2' }] } })).toEqual({
      available: true,
      interactionId: 'ix-2',
    });
  });
});

describe('human 断点路径', () => {
  it('approved 决策恢复并输出 decision', async () => {
    let resolvePause!: (d: 'approved' | 'rejected') => void;
    const running = runHumanNode({
      node: nd('h1', 'human', { prompt: '批准?' }),
      prompt: '批准?',
      signal,
      localPause: () =>
        new Promise<'approved' | 'rejected'>((resolve) => {
          resolvePause = resolve;
        }),
    });
    await Promise.resolve();
    resolvePause('approved');
    const outcome = await running;
    expect(outcome.outputs.decision).toBe('approved');
  });

  it('timeoutMs + onTimeout=proceed：超时放行且标记 timedOut', async () => {
    const outcome = await runHumanNode({
      node: nd('h2', 'human', { prompt: '批准?', timeoutMs: 20, onTimeout: 'proceed' }),
      prompt: '批准?',
      signal,
      localPause: () => new Promise<'approved' | 'rejected'>(() => {}),
    });
    expect(outcome.outputs.timedOut).toBe(true);
    expect(outcome.outputs.decision).toBe('proceed');
  });

  it('默认 onTimeout=abort：超时抛错', async () => {
    await expect(
      runHumanNode({
        node: nd('h3', 'human', { prompt: '批准?', timeoutMs: 20 }),
        prompt: '批准?',
        signal,
        localPause: () => new Promise<'approved' | 'rejected'>(() => {}),
      }),
    ).rejects.toThrow(/审批等待超时/);
  });

  it('rejected 决策抛错（编排器映射为 failed）', async () => {
    let rejectPause!: (d: 'approved' | 'rejected') => void;
    const running = runHumanNode({
      node: nd('h4', 'human', { prompt: '驳回?' }),
      prompt: '驳回?',
      signal,
      localPause: () =>
        new Promise<'approved' | 'rejected'>((resolve) => {
          rejectPause = resolve;
        }),
    });
    await Promise.resolve();
    rejectPause('rejected');
    await expect(running).rejects.toThrow(/驳回/);
  });

  it('无 localPause 时仅产出等待信号（两态同型 waiting 标记）', async () => {
    const hostMode = await runHumanNode({ node: nd('h5', 'human', { prompt: '?' }), prompt: '?', host: { pendingInteraction: { id: 'i9' } } });
    expect(hostMode.outputs.mode).toBe('host_interaction');
    const localMode = await runHumanNode({ node: nd('h6', 'human', { prompt: '?' }), prompt: '?' });
    expect(localMode.outputs.mode).toBe('local_paused');
  });
});
