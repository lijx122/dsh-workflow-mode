/**
 * M3 单测：RunOrchestrator —— 拓扑顺序 / onError 三路由 / skipped 传播 /
 * abort 语义 / iteration 循环 / human 断点恢复 / mock 会话驱动 llm 全链路。
 */
import { describe, it, expect, vi } from 'vitest';
import type { WorkflowDSL, WorkflowNode, WorkflowEdge } from '@dsh-workflow/schema';
import { RunOrchestrator } from './orchestrator.js';
import { createMockSessions } from './session-executor.js';

function dsl(partial: Partial<WorkflowDSL>): WorkflowDSL {
  return { version: 'dsh.workflow.v1', name: 't', nodes: [], edges: [], ...partial };
}
function nd(id: string, type: string, extra: Record<string, unknown> = {}): WorkflowNode {
  return { id, type, ...extra } as unknown as WorkflowNode;
}
function ed(source: string, target: string, extra: Partial<WorkflowEdge> = {}): WorkflowEdge {
  return { id: `e-${source}->${target}`, source, target, ...extra };
}

/** 收集状态轨迹：nodeId → [status 序列]。 */
function tracker() {
  const seen = new Map<string, string[]>();
  const onNodeState = (id: string, s: { status: string }) => {
    const list = seen.get(id) ?? [];
    list.push(s.status);
    seen.set(id, list);
  };
  return { seen, onNodeState };
}

describe('拓扑顺序与基础执行', () => {
  it('按拓扑序串行执行线性链，end 输出聚合进 result.outputs', async () => {
    const orch = new RunOrchestrator();
    const { seen, onNodeState } = tracker();
    const logs: string[] = [];
    const outcome = await orch.run(
      dsl({
        nodes: [
          nd('start', 'start', { inputs: { env: { type: 'string', default: 'prod' } } }),
          nd('tp', 'template', { template: 'deploy to {{#start.env}}' }),
          nd('end', 'end', { outputs: { report: '{{#tp.result}}' } }),
        ],
        edges: [ed('start', 'tp'), ed('tp', 'end')],
      }),
      { onNodeState, onLog: (m) => logs.push(m) },
    );
    expect(typeof outcome.runId).toBe('string');
    expect(outcome.runId.length).toBeGreaterThan(0);
    expect(outcome.result.status).toBe('completed');
    expect(outcome.result.outputs.report).toBe('deploy to prod');
    expect(seen.get('tp')).toEqual(['pending', 'running', 'completed']);
    // 拓扑序：tp 完成早于 end 完成（日志顺序佐证）
    const tpDone = logs.findIndex((l) => l.startsWith('[tp] 完成'));
    const endDone = logs.findIndex((l) => l.startsWith('[end] 完成'));
    expect(tpDone).toBeGreaterThanOrEqual(0);
    expect(endDone).toBeGreaterThan(tpDone);
  });

  it('菱形 fork-join：merge 等齐两分支后执行（串行）', async () => {
    const orch = new RunOrchestrator();
    const order: string[] = [];
    const outcome = await orch.run(
      dsl({
        nodes: [
          nd('s', 'start'),
          nd('a', 'code', { code: 'return { va: 1 };' }),
          nd('b', 'code', { code: 'return { vb: 2 };' }),
          nd('m', 'merge'),
          nd('e', 'end', { outputs: { all: '{{#m.a}}-{{#b.vb}}' } }),
        ],
        edges: [
          { id: 'e1', source: 's', target: 'a' },
          { id: 'e2', source: 's', target: 'b' },
          { id: 'e3', source: 'a', target: 'm' },
          { id: 'e4', source: 'b', target: 'm' },
          { id: 'e5', source: 'm', target: 'e' },
        ],
      }),
      { onLog: (msg) => order.push(msg.split(']')[0] + ']') },
    );
    expect(outcome.result.status).toBe('completed');
    const finished = order.filter((l) => l.startsWith('[m]'));
    expect(finished.length).toBeGreaterThan(0);
  });

  it('环路 DSL 直接抛错拒绝执行', async () => {
    const orch = new RunOrchestrator();
    await expect(
      orch.run(dsl({ nodes: [nd('a', 'start'), nd('b', 'set_variable', { assignments: [] })], edges: [ed('a', 'b'), ed('b', 'a')] })),
    ).rejects.toThrow(/环路/);
  });
});

describe('onError 三路由', () => {
  const boom = (id: string): WorkflowNode =>
    nd(id, 'code', { code: 'throw new Error("boom");' });

  it('stop（默认）：下游保持 pending，run 终态 failed', async () => {
    const orch = new RunOrchestrator();
    const { seen, onNodeState } = tracker();
    const outcome = await orch.run(
      dsl({
        nodes: [nd('s', 'start'), boom('f'), nd('after', 'template', { template: 'x' })],
        edges: [ed('s', 'f'), ed('f', 'after')],
      }),
      { onNodeState },
    );
    expect(outcome.result.status).toBe('failed');
    expect(seen.get('f')).toContain('failed');
    expect(seen.get('after')?.every((s) => s === 'pending')).toBe(true);
    expect(outcome.result.nodeStates.after.status).toBe('pending');
  });

  it('continue：下游照常执行完成', async () => {
    const orch = new RunOrchestrator();
    const { seen, onNodeState } = tracker();
    const outcome = await orch.run(
      dsl({
        nodes: [
          nd('s', 'start'),
          { ...boom('f'), onError: 'continue' },
          nd('after', 'template', { template: 'kept going' }),
        ],
        edges: [ed('s', 'f'), ed('f', 'after')],
      }),
      { onNodeState },
    );
    expect(outcome.result.nodeStates.f.status).toBe('failed');
    expect(outcome.result.nodeStates.after.status).toBe('completed');
    expect(outcome.result.status).toBe('failed'); // 有失败节点整体仍 failed
  });

  it('route：仅 error 标记边激活，正常边跳过；无 error 边退化为 stop', async () => {
    const orch = new RunOrchestrator();
    const { seen, onNodeState } = tracker();
    const outcome = await orch.run(
      dsl({
        nodes: [
          nd('s', 'start'),
          { ...boom('f'), onError: 'route' },
          nd('normal', 'template', { template: 'n' }),
          nd('fb', 'template', { template: 'fallback got {{#f.error}}' }),
        ],
        edges: [
          ed('s', 'f'),
          { id: 'en', source: 'f', target: 'normal' },
          { id: 'er', source: 'f', target: 'fb', branch: 'error' },
        ],
      }),
      { onNodeState },
    );
    expect(outcome.result.nodeStates.fb.status).toBe('completed');
    expect(outcome.result.nodeStates.normal.status).toBe('skipped');
    expect(outcome.result.nodeStates.f.error).toMatch(/boom/);

    // 无 error 边 → stop 语义
    const { seen: seen2, onNodeState: ons2 } = tracker();
    const out2 = await orch.run(
      dsl({
        nodes: [nd('s', 'start'), { ...boom('g'), onError: 'route' }, nd('h', 'template', { template: 'x' })],
        edges: [ed('s', 'g'), ed('g', 'h')],
      }),
      { onNodeState: ons2 },
    );
    expect(out2.result.nodeStates.h.status).toBe('pending');
    expect(seen2.get('g')).toContain('failed');
  });
});

describe('DPE 死路消除与 skipped 传播', () => {
  it('if_else 未命中分支下游整链 skipped；命中分支正常', async () => {
    const orch = new RunOrchestrator();
    const { seen, onNodeState } = tracker();
    const outcome = await orch.run(
      dsl({
        nodes: [
          nd('s', 'start', { inputs: { v: { type: 'number', default: 1 } } }),
          nd('gate', 'if_else', { condition: 's.v > 10' }),
          nd('hi', 'template', { template: 'high {{#s.v}}' }),
          nd('hiEnd', 'end', { outputs: { r: '{{#hi.result}}' } }),
          nd('lo', 'template', { template: 'low {{#s.v}}' }),
          nd('loEnd', 'end', { outputs: { r: '{{#lo.result}}' } }),
        ],
        edges: [
          ed('s', 'gate'),
          { id: 'et', source: 'gate', target: 'hi', branch: 'true' },
          { id: 'ef', source: 'gate', target: 'lo', branch: 'false' },
          ed('hi', 'hiEnd'),
          ed('lo', 'loEnd'),
        ],
      }),
      { onNodeState },
    );
    expect(outcome.result.status).toBe('completed');
    expect(outcome.result.nodeStates.lo.status).toBe('completed');
    expect(outcome.result.nodeStates.loEnd.status).toBe('completed');
    expect(outcome.result.nodeStates.hi.status).toBe('skipped');
    expect(seen.get('hiEnd')).toContain('skipped'); // skipped 向后继传播
    expect(Object.keys(outcome.result.outputs)).toEqual(['r']); // 仅命中链的 end 聚合
    expect(outcome.result.outputs.r).toBe('low 1');
  });

  it('switch 按 branch 值激活对应出边', async () => {
    const orch = new RunOrchestrator();
    const outcome = await orch.run(
      dsl({
        nodes: [
          nd('s', 'start', { inputs: { env: { type: 'string', default: 'staging' } } }),
          nd('sw', 'switch', {
            cases: [{ when: "s.env == 'prod'", value: 'deploy' }],
            defaultCase: 'preview',
          }),
          nd('dep', 'template', { template: 'deploying' }),
          nd('prev', 'template', { template: 'previewing' }),
        ],
        edges: [
          ed('s', 'sw'),
          { id: 'e1', source: 'sw', target: 'dep', sourceHandle: 'deploy' },
          { id: 'e2', source: 'sw', target: 'prev', sourceHandle: 'preview' },
        ],
      }),
    );
    expect(outcome.result.nodeStates.prev.status).toBe('completed');
    expect(outcome.result.nodeStates.dep.status).toBe('skipped');
  });
});

describe('abort 语义', () => {
  it('✕ 后不再派发新节点；已完成的保留 completed，未跑的保持 pending，run 终态 stopped', async () => {
    const orch = new RunOrchestrator();
    const ctrl = new AbortController();
    let ranFirst = false;
    const outcome = await orch.run(
      dsl({
        nodes: [
          nd('s', 'start'),
          nd('first', 'code', { code: 'return { ok: true };' }),
          nd('second', 'code', { code: 'return { never: true };' }),
        ],
        edges: [ed('s', 'first'), ed('first', 'second')],
      }),
      {
        signal: ctrl.signal,
        onLog: (msg) => {
          // first 自然完成后触发 ✕：second 不得再派发
          if (!ranFirst && msg.startsWith('[first] 完成')) {
            ranFirst = true;
            ctrl.abort();
          }
        },
      },
    );
    expect(outcome.result.status).toBe('stopped');
    expect(outcome.result.nodeStates.first.status).toBe('completed');
    expect(outcome.result.nodeStates.second.status).toBe('pending');
  });

  it('iteration 在子队列粒度停止派发剩余迭代，已完成迭代保留', async () => {
    const orch = new RunOrchestrator();
    const ctrl = new AbortController();
    let doneCount = 0;
    const outcome = await orch.run(
      dsl({
        nodes: [
          nd('s', 'start', { inputs: { arr: { type: 'object', default: [1, 2, 3, 4, 5] } } }),
          nd('it', 'iteration', {
            over: '{{#s.arr}}',
            body: [{ id: 'wash', type: 'code', code: 'return { v: inputs._item };' }],
          }),
        ],
        edges: [ed('s', 'it')],
      }),
      {
        signal: ctrl.signal,
        onLog: (msg) => {
          // 第 1 个迭代的 body 完成后触发 ✕：剩余迭代不再派发
          if (msg.startsWith('[wash] 完成')) {
            doneCount++;
            if (doneCount === 1) ctrl.abort();
          }
        },
      },
    );
    expect(outcome.result.status).toBe('stopped');
    const items = (outcome.result.nodeStates.it.outputs?.items as unknown[]) ?? [];
    expect(items.length).toBeLessThan(5);
    expect(items.length).toBeGreaterThanOrEqual(1);
  });

  it('派发前已中止：直接 stopped，所有节点 pending', async () => {
    const orch = new RunOrchestrator();
    const ctrl = new AbortController();
    ctrl.abort();
    const outcome = await orch.run(
      dsl({ nodes: [nd('s', 'start')], edges: [] }),
      { signal: ctrl.signal },
    );
    expect(outcome.result.status).toBe('stopped');
    expect(outcome.result.nodeStates.s.status).toBe('pending');
  });
});

describe('iteration 全图循环（§10 P1-16 内联子队列）', () => {
  it('批量清洗示例形态：over 数组 + body 链式输出聚合 items', async () => {
    const orch = new RunOrchestrator();
    const outcome = await orch.run(
      dsl({
        nodes: [
          nd('s', 'start', {
            inputs: {
              files: {
                type: 'object',
                default: [{ name: ' A.CSV ', size: 1 }, { name: 'B.txt', size: 2 }],
              },
            },
          }),
          nd('it', 'iteration', {
            over: '{{#s.files}}',
            body: [
              {
                id: 'trim',
                type: 'code',
                code: 'const it = inputs._item; return { name: String(it.name).trim(), size: it.size };',
              },
            ],
          }),
          nd('sv', 'set_variable', { assignments: [{ key: 'items', value: '{{#it.items}}' }] }),
          nd('e', 'end', { outputs: { cleaned: '{{#sv.items}}' } }),
        ],
        edges: [ed('s', 'it'), ed('it', 'sv'), ed('sv', 'e')],
      }),
    );
    expect(outcome.result.status).toBe('completed');
    const cleaned = outcome.result.outputs.cleaned as Array<{ name: string; size: number }>;
    expect(cleaned).toHaveLength(2);
    expect(cleaned[0]).toEqual({ name: 'A.CSV', size: 1 });
  });
});

describe('mock 会话驱动 llm 全链路', () => {
  it('llm：插值 prompt 投递 → 回收文本为 outputs.text/result → 豁免登记成对', async () => {
    const sessions = createMockSessions();
    sessions.queueReply('风险等级 HIGH：包含删除生产表语句');
    const orch = new RunOrchestrator();
    const logs: string[] = [];
    const outcome = await orch.run(
      dsl({
        nodes: [
          nd('s', 'start', { inputs: { diff: { type: 'string', default: '-DROP TABLE users;' } } }),
          nd('audit', 'llm', { prompt: '审计: {{#s.diff}}' }),
          nd('e', 'end', { outputs: { verdict: '{{#audit.text}}' } }),
        ],
        edges: [ed('s', 'audit'), ed('audit', 'e')],
      }),
      { sessions, onLog: (m) => logs.push(m) },
    );
    expect(outcome.result.status).toBe('completed');
    expect(outcome.result.outputs.verdict).toBe('风险等级 HIGH：包含删除生产表语句');
    expect(sessions.created).toHaveLength(1);
    expect(sessions.created[0].preset).toBe('standard');
    expect(sessions.prompts.get(sessions.created[0].sessionId)?.[0]).toBe('审计: -DROP TABLE users;');
    expect(logs.some((l) => l.includes('登记豁免'))).toBe(true);
  });

  it('subagent：preset 透传 + result 字段回收', async () => {
    const sessions = createMockSessions();
    sessions.queueReply('已完成文件写入');
    const orch = new RunOrchestrator();
    const outcome = await orch.run(
      dsl({
        nodes: [
          nd('s', 'start'),
          nd('worker', 'subagent', { preset: 'coder', prompt: '建一个 index.html' }),
          nd('e', 'end', { outputs: { done: '{{#worker.result}}' } }),
        ],
        edges: [ed('s', 'worker'), ed('worker', 'e')],
      }),
      { sessions },
    );
    expect(outcome.result.status).toBe('completed');
    expect(sessions.created[0].preset).toBe('coder');
    expect(sessions.created[0].workspaceId).toBe('subagent:worker');
    expect(outcome.result.outputs.done).toBe('已完成文件写入');
  });

  it('会话投递失败：节点 failed，onError=stop 下游不执行', async () => {
    const sessions = createMockSessions();
    sessions.failNextPrompt('模型配额耗尽');
    const orch = new RunOrchestrator();
    const outcome = await orch.run(
      dsl({
        nodes: [
          nd('s', 'start'),
          nd('ask', 'llm', { prompt: 'hi', onError: 'stop' }),
          nd('next', 'template', { template: 'x' }),
        ],
        edges: [ed('s', 'ask'), ed('ask', 'next')],
      }),
      { sessions },
    );
    expect(outcome.result.status).toBe('failed');
    expect(outcome.result.nodeStates.ask.status).toBe('failed');
    expect(outcome.result.nodeStates.ask.error).toMatch(/模型配额耗尽|创建运行会话/);
    expect(outcome.result.nodeStates.next.status).toBe('pending');
  });

  it('缺 sessions 句柄：llm 节点带指引地失败', async () => {
    const orch = new RunOrchestrator();
    const outcome = await orch.run(
      dsl({ nodes: [nd('s', 'start'), nd('a', 'llm', { prompt: 'x' })], edges: [ed('s', 'a')] }),
    );
    expect(outcome.result.nodeStates.a.error).toMatch(/sessions 句柄/);
  });
});

describe('human 断点（waiting_human 视觉信号）', () => {
  it('本地 paused：实时回调 waiting_human，approve(approved) 后恢复继续', async () => {
    const orch = new RunOrchestrator();
    const { seen, onNodeState } = tracker();
    let runId = '';
    const runningPromise = orch.run(
      dsl({
        nodes: [
          nd('s', 'start'),
          nd('confirm', 'human', { prompt: '继续部署?' }),
          nd('go', 'template', { template: 'deployed' }),
        ],
        edges: [ed('s', 'confirm'), ed('confirm', 'go')],
      }),
      {
        onNodeState,
        onRunStart: (id) => {
          runId = id;
        },
      },
    );

    // 等 confirm 进入 waiting_human
    await vi.waitFor(() => {
      expect(seen.get('confirm')).toContain('running');
    });
    // runHumanNode 同步进入 localPause；等待 waiting_human 出现
    await vi.waitFor(() => {
      expect(seen.get('confirm')).toContain('running');
      expect(orch.approve(runId, 'confirm', 'approved')).toBe(true);
    });

    const outcome = await runningPromise;
    expect(outcome.result.status).toBe('completed');
    expect(outcome.result.nodeStates.go.status).toBe('completed');
  }, 10000);

  it('驳回：human 节点 failed，onError 默认 stop', async () => {
    const orch = new RunOrchestrator();
    const { seen, onNodeState } = tracker();
    let runId = '';
    const runningPromise = orch.run(
      dsl({
        nodes: [
          nd('s', 'start'),
          nd('gate', 'human', { prompt: '批准?' }),
          nd('after', 'template', { template: 'x' }),
        ],
        edges: [ed('s', 'gate'), ed('gate', 'after')],
      }),
      { onNodeState, onRunStart: (id) => (runId = id) },
    );
    await vi.waitFor(() => {
      expect(seen.get('gate')).toContain('running');
      expect(orch.approve(runId, 'gate', 'rejected')).toBe(true);
    });
    const outcome = await runningPromise;
    expect(outcome.result.status).toBe('failed');
    expect(outcome.result.nodeStates.gate.error).toMatch(/驳回/);
    expect(outcome.result.nodeStates.after.status).toBe('pending');
  }, 10000);

  it('timeoutMs + onTimeout=proceed：超时自动放行', async () => {
    const orch = new RunOrchestrator();
    const outcome = await orch.run(
      dsl({
        nodes: [
          nd('s', 'start'),
          nd('slow', 'human', { prompt: '太久没人批', timeoutMs: 30, onTimeout: 'proceed' }),
          nd('after', 'template', { template: 'went ahead' }),
        ],
        edges: [ed('s', 'slow'), ed('slow', 'after')],
      }),
    );
    expect(outcome.result.status).toBe('completed');
    expect(outcome.result.nodeStates.after.status).toBe('completed');
  }, 10000);

  it('运行中止时挂起的断点立即失败落定', async () => {
    const orch = new RunOrchestrator();
    const { seen, onNodeState } = tracker();
    const ctrl = new AbortController();
    const runningPromise = orch.run(
      dsl({ nodes: [nd('s', 'start'), nd('h', 'human', { prompt: '?' })], edges: [ed('s', 'h')] }),
      {
        signal: ctrl.signal,
        onNodeState,
        onLog: () => {},
      },
    );
    await vi.waitFor(() => expect(seen.get('h')).toContain('running'));
    ctrl.abort();
    const outcome = await runningPromise;
    expect(outcome.result.status).toBe('stopped');
    expect(outcome.result.nodeStates.h.error).toMatch(/中止/);
  }, 10000);
});

describe('approveHuman 端到端（runWorkflow 路径，REVISE F4）', () => {
  it('runWorkflow 启动的 human 断点可经模块级 approveHuman 恢复；结束自动摘除', async () => {
    const mod = await import('./orchestrator.js');
    const sessions = createMockSessions();
    let resolveRun: ((v: unknown) => void) | undefined;
    const done = new Promise((r) => { resolveRun = r; });

    let runId = '';
    const promise = mod.runWorkflow(
      dsl({
        nodes: [
          nd('start', 'start'),
          nd('gate', 'human', { prompt: '审批?', timeoutMs: 60000 }),
          nd('end', 'end', { outputs: { ok: 'yes' } }),
        ],
        edges: [ed('start', 'gate'), ed('gate', 'end')],
      }),
      {
        sessions,
        onRunStart: (id) => { runId = id; },
        onNodeState: (_id, s) => { if (s.status === 'waiting_human') setTimeout(() => resolveRun?.(null), 0); },
      },
    );

    // 等 waiting_human 出现
    await done;
    expect(runId).not.toBe('');

    // 模块级恢复（不经实例引用）
    const ok = mod.approveHuman(runId, 'gate', 'approved');
    expect(ok).toBe(true);
    const outcome = await promise;
    expect(outcome.result.status).toBe('completed');

    // 结束后映射已摘除：再次 approve 返回 false
    expect(mod.approveHuman(runId, 'gate', 'approved')).toBe(false);
  });
});
