/**
 * RunOrchestrator (M3, design §5 / §10 P1-16 / P2-19)。
 *
 * 冻结契约：runWorkflow(dsl, { onNodeState(nodeId,state), onLog(msg), signal })
 *   ⇒ Promise<{ runId, result }>。
 * 状态机（§10 P1-8 全量枚举）：pending → running → completed | failed |
 * skipped | waiting_human；实时回调画布。
 *
 * 调度语义：
 * - 拓扑排序串行调度（本期不做并行分支，fork-join 视觉保留、执行串行，
 *   TECH_DEBT 已登记）；就绪队列按拓扑序取最小者派发，保证确定性。
 * - DPE 死路消除：if_else/switch 仅命中 branch 出边激活（edge.branch 或
 *   edge.sourceHandle 匹配），未命中出边传播 skipped 令牌；全部入边 skipped
 *   的节点置 skipped 并继续向后继传播。
 * - onError 三路由：stop（默认，下游保持 pending）/ continue（全部出边放行）/
 *   route（仅 error 标记边激活：branch==="error" 或 sourceHandle==="error"；
 *   无 error 边时退化为 stop）。
 * - AbortSignal（✕）：不再派发新节点；已发出的会话回合等待自然返回后正常
 *   回收（iteration 在子队列粒度停止派发剩余迭代）。终态 stopped。
 * - human 断点：waiting_human 实时回调；恢复经 approveHuman(runId,nodeId,
 *   decision)；timeoutMs 到时按 onTimeout abort|proceed 处理。
 */
import type { WorkflowDSL, WorkflowNode, WorkflowEdge } from '@dsh-workflow/schema';
import { VariableContext, type JsonValue } from './variable-context.js';
import {
  createLocalExecutors,
  type ExecutorContext,
  type LocalExecutorRegistry,
  type NodeDispatcher,
  type NodeOutput,
} from './local-executors.js';
import {
  runSessionNode,
  runHumanNode,
  type SessionsHandle,
} from './session-executor.js';

// ---------------- 公共类型 ----------------

/** §10 P1-8 全量状态枚举（冻结）。 */
export type OrchestratorNodeStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'waiting_human';

/** NodeStateInfo 冻结形状（types.ts 由 M2 统一维护，此处结构对齐）。 */
export interface OrchestratorNodeState {
  status: OrchestratorNodeStatus;
  outputs?: Record<string, unknown>;
  durationMs?: number;
  error?: string;
}

export interface RunWorkflowOptions {
  /** 节点状态变更回调（每次传快照副本）。 */
  onNodeState?(nodeId: string, state: OrchestratorNodeState): void;
  /** 运行日志回调（时间戳由 UI 层附加）。 */
  onLog?(msg: string): void;
  /** ✕ 中止信号：不再派发新节点，已发出者等待自然返回。 */
  signal?: AbortSignal;
  /** 会话句柄（llm/subagent 必需；缺省时相应节点失败并给出指引）。 */
  sessions?: SessionsHandle;
  /** 宿主 client ctx（human pendingInteraction 能力探测来源）。 */
  host?: unknown;
  /** M3 本地扩展：runId 分配即回调（UI 关联断点恢复用，非冻结字段）。 */
  onRunStart?(runId: string): void;
  /** M3 本地扩展：注入既有编排器实例（approveHuman 实例映射路径用，非冻结字段）。 */
  orchestrator?: RunOrchestrator;
}

export interface RunResult {
  status: 'completed' | 'failed' | 'stopped';
  nodeStates: Record<string, OrchestratorNodeState>;
  outputs: Record<string, JsonValue>;
}

export interface RunOutcome {
  runId: string;
  result: RunResult;
}

const BRANCH_ROUTE_TYPES: ReadonlySet<string> = new Set(['if_else', 'switch']);

function generateRunId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 声明 inputs 解析：字符串经 ref 保型解析（失败回退字面量），其余透传。 */
function resolveDeclaredInputs(
  node: WorkflowNode,
  varCtx: VariableContext,
): Record<string, JsonValue> {
  const raw = (node as { inputs?: unknown }).inputs;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const res: Record<string, JsonValue> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') {
      try {
        res[k] = varCtx.ref(v);
      } catch {
        res[k] = v;
      }
    } else {
      res[k] = v as JsonValue;
    }
  }
  return res;
}

function edgeLive(source: WorkflowNode, output: NodeOutput | undefined, edge: WorkflowEdge): boolean {
  if (!BRANCH_ROUTE_TYPES.has(source.type)) return true;
  const branch =
    output && typeof output.branch === 'string' ? output.branch : undefined;
  // 路由节点未上报 branch → 出边全部视为死路，避免 fork-join 死锁
  if (typeof branch !== 'string') return false;
  return edge.branch === branch || edge.sourceHandle === branch;
}

interface HumanWaiter {
  resolve(decision: 'approved' | 'rejected'): void;
  reject(err: Error): void;
}

// ---------------- 编排器 ----------------

export class RunOrchestrator {
  private readonly localExecutors: LocalExecutorRegistry = createLocalExecutors();
  private readonly humanWaiters = new Map<string, HumanWaiter>();

  /**
   * 恢复本地 paused 的 human 断点。
   * @returns 是否存在该挂起断点并已投递决策。
   */
  approve(runId: string, nodeId: string, decision: 'approved' | 'rejected'): boolean {
    const key = `${runId}:${nodeId}`;
    const waiter = this.humanWaiters.get(key);
    if (!waiter) return false;
    this.humanWaiters.delete(key);
    waiter.resolve(decision);
    return true;
  }

  /** 执行工作流（串行拓扑调度），解析 { runId, result }。 */
  async run(dsl: WorkflowDSL, options: RunWorkflowOptions = {}): Promise<RunOutcome> {
    // REVISE F4：登记/摘除包装——无论正常返回、失败还是抛错，结束即从 runOwners 摘除。
    const runId = generateRunId();
    options.onRunStart?.(runId);
    runOwners.set(runId, this);
    try {
      return await this.runInternal(runId, dsl, options);
    } finally {
      runOwners.delete(runId);
    }
  }

  private async runInternal(
    runId: string,
    dsl: WorkflowDSL,
    options: RunWorkflowOptions = {},
  ): Promise<RunOutcome> {
    const rawOnNodeState = options.onNodeState ?? (() => {});
    const rawOnLog = options.onLog ?? (() => {});
    // REVISE P1-2：回调抛错不得中断调度（否则可能造成豁免/断点泄漏）
    const onNodeState = (nodeId: string, state: OrchestratorNodeState): void => {
      try {
        rawOnNodeState(nodeId, state);
      } catch (error) {
        console.error('[dsh-workflow] onNodeState callback error:', error);
      }
    };
    const onLog = (msg: string): void => {
      try {
        rawOnLog(msg);
      } catch (error) {
        console.error('[dsh-workflow] onLog callback error:', error);
      }
    };
    const signal = options.signal ?? new AbortController().signal;

    if (!dsl || !Array.isArray(dsl.nodes)) {
      throw new Error('无效 DSL：缺少 nodes 数组');
    }

    // ---- 图构建与静态校验 ----
    const nodeById = new Map<string, WorkflowNode>();
    for (const n of dsl.nodes) {
      if (!n || typeof n.id !== 'string') throw new Error('无效 DSL：存在缺失 id 的节点');
      if (nodeById.has(n.id)) throw new Error(`无效 DSL：节点 id "${n.id}" 重复`);
      nodeById.set(n.id, n);
    }
    const edges: WorkflowEdge[] = Array.isArray(dsl.edges) ? dsl.edges : [];
    const outEdges = new Map<string, WorkflowEdge[]>();
    const inEdges = new Map<string, WorkflowEdge[]>();
    for (const e of edges) {
      if (!e || !nodeById.has(e.source) || !nodeById.has(e.target)) {
        throw new Error(
          `无效 DSL：边 "${e?.id ?? '?'}" 引用了不存在的节点 (${e?.source} → ${e?.target})`,
        );
      }
      if (!outEdges.has(e.source)) outEdges.set(e.source, []);
      if (!inEdges.has(e.target)) inEdges.set(e.target, []);
      outEdges.get(e.source)!.push(e);
      inEdges.get(e.target)!.push(e);
    }

    // ---- Kahn 拓扑排序（FIFO 稳定序）；有环即拒绝执行 ----
    const indegree = new Map<string, number>();
    for (const id of nodeById.keys()) indegree.set(id, (inEdges.get(id) ?? []).length);
    const queue: string[] = [];
    for (const id of nodeById.keys()) if ((indegree.get(id) ?? 0) === 0) queue.push(id);
    const topoOrder: string[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      topoOrder.push(id);
      for (const e of outEdges.get(id) ?? []) {
        const w = (indegree.get(e.target) ?? 0) - 1;
        indegree.set(e.target, w);
        if (w === 0) queue.push(e.target);
      }
    }
    if (topoOrder.length !== nodeById.size) {
      const cyclic = [...nodeById.keys()].filter((id) => !topoOrder.includes(id));
      throw new Error(`无效 DSL：检测到环路，涉及节点 [${cyclic.join(', ')}]`);
    }
    const topoIndex = new Map(topoOrder.map((id, i) => [id, i]));

    // ---- 运行状态初始化 ----
    const states = new Map<string, OrchestratorNodeState>();
    for (const id of nodeById.keys()) {
      states.set(id, { status: 'pending' });
      onNodeState(id, { ...states.get(id)! });
    }
    const varCtx = new VariableContext();
    const waiting = new Map<string, number>();
    for (const id of nodeById.keys()) waiting.set(id, (inEdges.get(id) ?? []).length);
    const validReceived = new Set<string>();
    const ready: string[] = [];
    let endOutputsMerged: Record<string, JsonValue> = {};
    let sawFailure = false;

    onLog(`[run:${runId}] 开始执行 "${dsl.name ?? 'unnamed'}"（共 ${nodeById.size} 节点，串行拓扑调度）`);

    const emit = (id: string): void => {
      onNodeState(id, { ...states.get(id)! });
    };

    const setState = (id: string, next: OrchestratorNodeState): void => {
      states.set(id, next);
      emit(id);
    };

    // DPE：一条入边令牌释放；扣减到零按有效到达与否派发或跳过级联
    const releaseEdge = (edge: WorkflowEdge, live: boolean): void => {
      const t = edge.target;
      const w = (waiting.get(t) ?? 0) - 1;
      waiting.set(t, w);
      if (live) validReceived.add(t);
      if (w === 0) {
        if (validReceived.has(t)) ready.push(t);
        else skipCascade(t);
      }
    };

    const skipCascade = (id: string): void => {
      if (states.get(id)!.status !== 'pending') return;
      setState(id, { status: 'skipped' });
      onLog(`[${id}] 死路消除：全部入边均为跳过令牌 → skipped`);
      for (const e of outEdges.get(id) ?? []) releaseEdge(e, false);
    };

    // 全类型派发器：iteration body 经此递归执行任意类型子节点
    const dispatcher: NodeDispatcher = async (bodyNode, childCtx, inputsOverride) => {
      const declared =
        bodyNode.type === 'start' ? {} : resolveDeclaredInputs(bodyNode, varCtx);
      const execCtx: ExecutorContext = {
        ...childCtx,
        inputs: { ...(inputsOverride ?? {}), ...declared },
      };
      if (
        bodyNode.type === 'llm' ||
        bodyNode.type === 'subagent' ||
        bodyNode.type === 'human'
      ) {
        const outs = await execSessionDriven(bodyNode, execCtx);
        return outs;
      }
      const executor = this.localExecutors.get(bodyNode.type);
      if (!executor) {
        throw new Error(`节点 "${bodyNode.id}" 类型 "${bodyNode.type}" 无可用执行器`);
      }
      const bodyStartedAt = Date.now();
      try {
        const outs = await executor(bodyNode, execCtx, dispatcher);
        childCtx.log(`[${bodyNode.id}] 完成 (耗时 ${Date.now() - bodyStartedAt}ms)`);
        return outs;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        childCtx.log(`[${bodyNode.id}] 失败: ${msg}`);
        throw error;
      }
    };

    // ---- 会话驱动节点（llm / subagent / human） ----
    const execSessionDriven = async (
      node: WorkflowNode,
      ctx: ExecutorContext,
    ): Promise<NodeOutput> => {
      if (node.type === 'human') {
        const promptText = ctx.varCtx.interpolate(String((node as { prompt?: unknown }).prompt ?? ''));
        const key = `${runId}:${node.id}`;
        const pausePromise = new Promise<'approved' | 'rejected'>((resolve, reject) => {
          this.humanWaiters.set(key, { resolve, reject });
        });
        pausePromise.then(
          () => this.humanWaiters.delete(key),
          () => this.humanWaiters.delete(key),
        );
        // waiting_human 视觉信号（§10 P1-8/P1-21：宿主交互与本地 paused 两态同型）
        setState(node.id, { status: 'waiting_human' });
        ctx.log(`[${node.id}] 断点：等待人工审批（waiting_human）`);
        try {
          const outcome = await runHumanNode({
            node,
            prompt: promptText,
            host: options.host,
            signal: ctx.signal,
            onLog: ctx.log,
            localPause: () => pausePromise,
          });
          setState(node.id, { status: 'running' });
          return outcome.outputs as NodeOutput;
        } catch (error) {
          // 断点被打断（驳回/超时 abort/运行中止）：恢复 running 供失败态覆盖
          setState(node.id, { status: 'running' });
          throw error;
        }
      }

      if (!options.sessions) {
        throw new Error(
          `节点 "${node.id}" 为 ${node.type} 类型但未注入 sessions 句柄（options.sessions），无法执行`,
        );
      }
      const rawPrompt = String((node as { prompt?: unknown }).prompt ?? '');
      const prompt = ctx.varCtx.interpolate(rawPrompt);
      const systemRaw = (node as { systemPrompt?: unknown }).systemPrompt;
      const systemPrompt =
        typeof systemRaw === 'string' && systemRaw.length > 0
          ? ctx.varCtx.interpolate(systemRaw)
          : undefined;
      const outcome = await runSessionNode(options.sessions, {
        node,
        prompt,
        systemPrompt,
        signal: ctx.signal,
        onLog: ctx.log,
        host: options.host,
      });
      return outcome.outputs as NodeOutput;
    };

    // ---- 单节点执行 ----
    const executeNode = async (id: string): Promise<void> => {
      const node = nodeById.get(id)!;
      const startedAt = Date.now();
      setState(id, { status: 'running' });
      onLog(`[${id}] 执行中 (${node.type})...`);

      const baseCtx: ExecutorContext = {
        runId,
        nodeId: id,
        signal,
        log: onLog,
        varCtx,
        predecessors: (inEdges.get(id) ?? []).map((e) => e.source),
        inputs: {},
      };

      let outputs: NodeOutput;
      try {
        if (
          node.type === 'llm' ||
          node.type === 'subagent' ||
          node.type === 'human'
        ) {
          outputs = await execSessionDriven(node, baseCtx);
        } else {
          const executor = this.localExecutors.get(node.type);
          if (!executor) {
            throw new Error(`节点 "${id}" 类型 "${node.type}" 无可用执行器`);
          }
          const declared = node.type === 'start' ? {} : resolveDeclaredInputs(node, varCtx);
          outputs = await executor(node, { ...baseCtx, inputs: declared }, dispatcher);
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        const durationMs = Date.now() - startedAt;
        sawFailure = true;
        this.humanWaiters.delete(`${runId}:${id}`);
        // 注：abort 不产生 skipped——skipped 仅用于死路消除语义（§10 P1-8）
        setState(id, { status: 'failed', error: errMsg, durationMs });
        onLog(`[${id}] ${signal.aborted ? '已中止' : '失败'}: ${errMsg}`);

        if (signal.aborted) return; // ✕ 后不再做任何传播

        const onError = (node as { onError?: 'stop' | 'continue' | 'route' }).onError;
        if (onError === 'continue') {
          for (const e of outEdges.get(id) ?? []) releaseEdge(e, true);
        } else if (onError === 'route') {
          const succs = outEdges.get(id) ?? [];
          const isErrorEdge = (e: WorkflowEdge) =>
            e.branch === 'error' || e.sourceHandle === 'error';
          if (succs.some(isErrorEdge)) {
            const payload: NodeOutput = { error: errMsg, errorNode: id };
            varCtx.set(id, payload);
            setState(id, {
              status: 'failed',
              error: errMsg,
              durationMs,
              outputs: payload,
            });
            for (const e of succs) releaseEdge(e, isErrorEdge(e));
          }
          // 无 error 标记出边 → 维持 stop 语义
        }
        // stop / 默认：不传播，下游保持 pending
        return;
      }

      const durationMs = Date.now() - startedAt;
      varCtx.set(id, outputs);
      setState(id, { status: 'completed', outputs, durationMs });
      onLog(`[${id}] 完成 (耗时 ${durationMs}ms)`);
      if (node.type === 'end') {
        endOutputsMerged = { ...endOutputsMerged, ...outputs };
      }
      for (const e of outEdges.get(id) ?? []) {
        releaseEdge(e, edgeLive(node, outputs, e));
      }
    };

    // ---- 主循环：播种 + 串行派发 ----
    for (const id of nodeById.keys()) {
      if ((waiting.get(id) ?? 0) === 0) ready.push(id);
    }

    while (ready.length > 0) {
      if (signal.aborted) break; // ✕：不再派发新节点
      let best = 0;
      for (let i = 1; i < ready.length; i++) {
        if (topoIndex.get(ready[i])! < topoIndex.get(ready[best])!) best = i;
      }
      const id = ready.splice(best, 1)[0];
      if (states.get(id)!.status !== 'pending') continue;
      await executeNode(id);
    }

    // ---- 终态聚合 ----
    const nodeStates: Record<string, OrchestratorNodeState> = {};
    for (const [id, s] of states) nodeStates[id] = s;
    const hasFailed = Object.values(nodeStates).some((s) => s.status === 'failed');
    const status: RunResult['status'] = signal.aborted
      ? 'stopped'
      : hasFailed
        ? 'failed'
        : 'completed';
    onLog(
      `[run:${runId}] 运行结束: ${status}（完成 ${Object.values(nodeStates).filter((s) => s.status === 'completed').length}/${nodeById.size}）`,
    );

    return {
      runId,
      result: { status, nodeStates, outputs: endOutputsMerged },
    };
  }
}

// ---------------- 实例级断点注册表（REVISE P1-3） ----------------

/**
 * REVISE P1-3：runId → 编排器实例映射，替代单例绑定。
 * runWorkflow 便捷入口与 new RunOrchestrator() 直接实例化两条路径的
 * human 断点都能经 approveHuman(runId,...) 精确恢复；run 结束即摘除，
 * 无跨运行串扰与内存滞留。
 */
const runOwners = new Map<string, RunOrchestrator>();

/** 冻结契约入口：runWorkflow(dsl, { onNodeState, onLog, signal })。 */
export function runWorkflow(
  dsl: WorkflowDSL,
  options: RunWorkflowOptions = {},
): Promise<RunOutcome> {
  const orchestrator = options.orchestrator ?? new RunOrchestrator();
  return orchestrator.run(dsl, options);
}

/**
 * 恢复指定 run 的 human 断点（按 runId 定位其编排器实例；
 * 兼容默认便捷入口与自建实例两种来源）。
 */
export function approveHuman(
  runId: string,
  nodeId: string,
  decision: 'approved' | 'rejected',
): boolean {
  const owner = runOwners.get(runId);
  if (!owner) return false;
  return owner.approve(runId, nodeId, decision);
}
