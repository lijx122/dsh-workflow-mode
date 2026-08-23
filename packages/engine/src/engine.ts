import PQueue from "p-queue";
import crypto from "node:crypto";
import {
  validateWorkflow,
  WorkflowDSL,
  WorkflowNode,
  WorkflowEdge,
  NodeType,
  ValidateResult,
} from "@dsh-workflow/schema";
import { VariableContext, type JsonValue } from "./variable-context.js";

// ================= 共享类型（契约对齐） =================

export interface NodeOutput {
  [key: string]: JsonValue;
}

export type NodeStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "waiting_human"
  | "skipped";

export interface NodeExecutor {
  type: NodeType;
  execute(
    node: WorkflowNode,
    inputs: Record<string, JsonValue>,
    ctx: ExecutionContext,
  ): Promise<NodeOutput>;
}

/**
 * DSH host 服务适配器（T6 注入模式）：
 * engine 包不直接 import DSH 运行时，T7 preset 组合层把真实服务注入
 * Engine 构造函数 options.host；单测注入 mock。各服务可选——
 * 执行器取用时缺失即抛带指引的错误（见 executors/errors.ts 的 hostNotBound）。
 */
export interface HostServices {
  /** plugin_tool 反射调用：注册表式工具（如 tool-fs/tool-git） */
  tools?: {
    /**
     * 调用工具。args 由 executor 组装：{ ...node.inputs, action? }（node.action 权威）。
     * 工具不存在时实现方可拒绝（reject）或经 has() 前置检查。
     */
    invoke(
      toolName: string,
      args: Record<string, JsonValue>,
    ): Promise<JsonValue>;
    /** 可选：工具存在性检查，供 executor 在调用前给出明确报错 */
    has?(toolName: string): boolean;
  };
  /** llm / intent_classifier / parameter_extractor 的模型补全通道 */
  llm?: {
    complete(args: {
      model?: string;
      prompt: string;
      systemPrompt?: string;
      outputSchema?: unknown;
    }): Promise<{ text: string }>;
  };
  /** subagent 节点：子代理一次性 spawn，结构化回收 result */
  subagents?: {
    spawn(args: {
      prompt: string;
      preset?: string;
    }): Promise<{ result: JsonValue }>;
  };
  /** human 节点：人机审批通道；decision 语义 "approved"|"rejected"|"proceed" */
  askUser?: (args: {
    prompt: string;
    inputs?: Record<string, JsonValue>;
  }) => Promise<{ decision: string; inputs?: Record<string, JsonValue> }>;
  /** code 节点 Worker 沙箱（T5 已绑定，保留占位） */
  codeRuntime?: unknown;
}

export interface ExecutionContext {
  runId: string;
  nodeId: string;
  signal: AbortSignal;
  log(event: RunEvent): void;
  varCtx: VariableContext;
  callStack?: string[];
  host: HostServices;
}

export interface RunEvent {
  timestamp: number;
  runId: string;
  type:
    | "run_start"
    | "run_finish"
    | "node_start"
    | "node_finish"
    | "node_error"
    | "node_skip"
    | "human_wait";
  nodeId?: string;
  data?: Record<string, JsonValue>;
}

export interface NodeState {
  status: NodeStatus;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
}

export type RunStatus = "running" | "waiting_human" | "success" | "failed" | "stopped";

export interface RunResult {
  runId: string;
  status: "success" | "failed" | "stopped";
  nodeStates: Record<string, NodeState>;
  outputs: Record<string, NodeOutput>;
  events: RunEvent[];
}

export interface EngineOptions {
  maxParallelNodes?: number;
  /**
   * 节点默认超时（ms）。节点级 timeoutMs 优先；0 / undefined = 不设超时。
   * 到时该次 executor 调用以含 "timeout" 的错误失败，并中止 run 级 AbortController（熔断传播）。
   */
  defaultNodeTimeoutMs?: number;
  /**
   * DSH host 服务适配器（T6 注入模式）：缺省全部未绑定，绑定后由
   * human/llm/subagent/plugin_tool 执行器取用。见 HostServices。
   */
  host?: HostServices;
}

export interface RunExecutionOptions {
  runId?: string;
  onEvent?: (event: RunEvent) => void;
  isTest?: boolean;
  host?: HostServices;
}

// ================= 校验错误 =================

export class WorkflowValidationError extends Error {
  readonly result: ValidateResult;

  constructor(result: ValidateResult) {
    super(`工作流校验失败: ${result.errors.length} 个错误`);
    this.name = "WorkflowValidationError";
    this.result = result;
  }
}

// ================= 运行内部状态 =================

interface PendingHuman {
  resolve: (res: { decision: string; inputs?: Record<string, JsonValue> }) => void;
  reject: (err: Error) => void;
  prompt: string;
  inputs?: Record<string, JsonValue>;
}

interface RunControl {
  runId: string;
  workflowName: string;
  status: RunStatus;
  startedAt: number;
  finishedAt?: number;
  aborted: boolean;
  stopRequested: boolean;
  controller: AbortController;
  nodeStates: Record<string, NodeState>;
  outputs: Record<string, NodeOutput>;
  events: RunEvent[];
  pendingHumans: Map<string, PendingHuman>;
}

/**
 * 分支路由节点类型（DPE，ARCHITECTURE §5.1）：
 * 执行器输出约定 `{ branch: string }` 决定激活的出边；未命中分支的出边向下游传播 SKIPPED 令牌。
 * T10 扩展 switch 时加入该集合。
 */
const BRANCH_ROUTE_TYPES: ReadonlySet<NodeType> = new Set<NodeType>([
  "if_else",
]);

// ================= 工具函数 =================

function resolveNodeInputs(
  node: WorkflowNode,
): Record<string, JsonValue> {
  const raw = (node as Record<string, unknown>).inputs;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, JsonValue>;
  }
  return {};
}

// ================= WorkflowEngine =================

export class WorkflowEngine {
  private readonly executors: Record<NodeType, NodeExecutor>;
  private readonly maxParallelNodes: number;
  private readonly defaultNodeTimeoutMs?: number;
  private readonly host: ExecutionContext["host"];
  private readonly runs = new Map<string, RunControl>();
  private readonly completedRuns = new Map<string, RunControl>();

  constructor(
    executors: Record<NodeType, NodeExecutor>,
    options: EngineOptions = {},
  ) {
    this.executors = executors;
    this.maxParallelNodes = options.maxParallelNodes ?? 8;
    this.defaultNodeTimeoutMs = options.defaultNodeTimeoutMs;
    this.host = {
      tools: undefined,
      llm: undefined,
      subagents: undefined,
      codeRuntime: undefined,
      ...options.host,
    } as ExecutionContext["host"];
  }

  /**
   * 运行一个工作流，返回 RunResult。
   *
   * 校验失败时抛出 WorkflowValidationError（携带 ValidateResult）。
   * 成功后解析 RunResult，status 为 "success" / "failed" / "stopped"。
   *
   * T4b 语义：
   * - 快照隔离：run 启动时 structuredClone(dsl) 作为执行图，文件/外部修改不影响进行中 run；
   * - 超时熔断：节点级 timeoutMs 覆盖引擎默认 defaultNodeTimeoutMs，到时该次调用失败（错误含 "timeout"）
   *   并中止 run 级 AbortController；
   * - retry：失败后按 backoffMs 延迟重试至多 max 次，每次尝试记入 node_error（attempt 字段），
   *   最终仍败才置 failed；
   * - DPE 死路径消除：路由节点仅命中 branch 出边激活，未命中分支传播 SKIPPED；SKIPPED 入边扣减待等待
   *   入度；全部 SKIPPED → 节点 skipped 并继续传播；至少一条有效入边 → OR-Join 触发执行。
   */
  async run(
    dsl: WorkflowDSL,
    inputs: Record<string, JsonValue>,
    runOptions?: RunExecutionOptions,
  ): Promise<RunResult> {
    // ---- 快照隔离：执行图固定为该 run 启动时的深拷贝 ----
    const snapshot = structuredClone(dsl) as WorkflowDSL;

    // ---- 前置校验（基于快照） ----
    const validationResult = validateWorkflow(snapshot);
    if (!validationResult.ok) {
      throw new WorkflowValidationError(validationResult);
    }

    const executors = this.executors;
    const defaultNodeTimeoutMs = this.defaultNodeTimeoutMs;

    // ---- 运行初始化 ----
    const runId = runOptions?.runId ?? crypto.randomUUID();
    const controller = new AbortController();
    const startedAt = Date.now();
    const nodeStates: Record<string, NodeState> = {};
    for (const n of snapshot.nodes) {
      nodeStates[n.id] = { status: "pending" };
    }
    const outputs: Record<string, NodeOutput> = {};
    const events: RunEvent[] = [];

    const control: RunControl = {
      runId,
      workflowName: snapshot.name,
      status: "running",
      startedAt,
      aborted: false,
      stopRequested: false,
      controller,
      nodeStates,
      outputs,
      events,
      pendingHumans: new Map(),
    };
    this.runs.set(runId, control);

    const nodes = new Map(snapshot.nodes.map((n) => [n.id, n]));

    // 边索引（按边计，支持 multigraph 与带 branch 的 DPE 出边）
    const outEdges = new Map<string, WorkflowEdge[]>();
    const inEdges = new Map<string, WorkflowEdge[]>();
    for (const e of snapshot.edges) {
      if (!outEdges.has(e.source)) outEdges.set(e.source, []);
      outEdges.get(e.source)!.push(e);
      if (!inEdges.has(e.target)) inEdges.set(e.target, []);
      inEdges.get(e.target)!.push(e);
    }

    // 待等待入度：按入边数计；DPE 语义下 SKIPPED 边到达即扣减
    const waiting = new Map<string, number>();
    for (const n of snapshot.nodes) {
      waiting.set(n.id, (inEdges.get(n.id) ?? []).length);
    }
    /** 至少一条有效入边已完成的节点集合（OR-Join 触发依据） */
    const validReceived = new Set<string>();

    const varCtx = new VariableContext();
    const startNode = snapshot.nodes.find((n) => n.type === "start");
    if (startNode) {
      varCtx.set(startNode.id, inputs);
    }

    // ---- 调度器 ----
    const queue = new PQueue({ concurrency: this.maxParallelNodes });

    let resolveDone!: () => void;
    const done = new Promise<void>((r) => {
      resolveDone = r;
    });

    let completedCount = 0;
    let inflight = 0;
    const totalCount = snapshot.nodes.length;

    const emit = (
      type: RunEvent["type"],
      nodeId?: string,
      data?: Record<string, JsonValue>,
    ) => {
      const ev: RunEvent = { timestamp: Date.now(), runId, type, nodeId, data };
      events.push(ev);
      runOptions?.onEvent?.(ev);
    };
    emit("run_start");

    // 是否存在仍可派发的节点（pending 且待等待入度已归零）
    function hasRunnable(): boolean {
      return snapshot.nodes.some(
        (n) =>
          nodeStates[n.id].status === "pending" &&
          (waiting.get(n.id) ?? 1) === 0,
      );
    }

    function maybeFinish(): void {
      // 无在途任务且（全部完成 / 已中止 / 无任何节点可再派发，如失败传播导致下游永久阻塞）即完结
      if (
        inflight === 0 &&
        (completedCount === totalCount ||
          control.aborted ||
          !hasRunnable())
      ) {
        resolveDone();
      }
    }

    const effectiveHost = {
      ...this.host,
      ...runOptions?.host,
    };

    const makeCtx = (nodeId: string): ExecutionContext => {
      let runAskUser = effectiveHost.askUser;
      if (runAskUser) {
        const originalAskUser = runAskUser;
        runAskUser = (args: { prompt: string; inputs?: Record<string, JsonValue> }) => {
          nodeStates[nodeId].status = "waiting_human";
          control.status = "waiting_human";
          emit("human_wait", nodeId, { prompt: args.prompt, ...(args.inputs ? { inputs: args.inputs } : {}) });

          return new Promise<{ decision: string; inputs?: Record<string, JsonValue> }>((resolve, reject) => {
            let settled = false;
            const safeResolve = (res: { decision: string; inputs?: Record<string, JsonValue> }) => {
              if (settled) return;
              settled = true;
              control.pendingHumans.delete(nodeId);
              if (control.pendingHumans.size === 0 && control.status === "waiting_human") {
                control.status = "running";
              }
              nodeStates[nodeId].status = "running";
              resolve(res);
            };
            const safeReject = (err: Error) => {
              if (settled) return;
              settled = true;
              control.pendingHumans.delete(nodeId);
              reject(err);
            };

            control.pendingHumans.set(nodeId, {
              resolve: safeResolve,
              reject: safeReject,
              prompt: args.prompt,
              inputs: args.inputs,
            });

            originalAskUser(args).then(safeResolve, safeReject);
          });
        };
      }

      return {
        runId,
        nodeId,
        signal: controller.signal,
        log: (ev: RunEvent) => {
          const fullEv = { ...ev, runId, timestamp: Date.now() };
          events.push(fullEv);
          runOptions?.onEvent?.(fullEv);
        },
        varCtx,
        host: {
          ...effectiveHost,
          askUser: runAskUser,
        },
      };
    };

    const delay = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));

    /**
     * 超时熔断：按节点级 timeoutMs（缺省用引擎默认）包裹单次 executor 调用；
     * 到时该次调用以含 "timeout" 的错误失败，同时中止 run 级 AbortController
     * （契约：run 的 AbortController 在超时与 stop() 时 abort，进行中的 executor 可感知）。
     * 超时后的底层 promise 继续浮动，其结果被忽略（不污染节点状态）。
     */
    function execWithinTimeout(
      node: WorkflowNode,
      executor: NodeExecutor,
      nodeInputs: Record<string, JsonValue>,
      timeoutMs: number | undefined,
    ): Promise<NodeOutput> {
      const p = executor.execute(node, nodeInputs, makeCtx(node.id));
      if (!timeoutMs || timeoutMs <= 0) return p;
      let timer: ReturnType<typeof setTimeout> | undefined;
      return new Promise<NodeOutput>((resolve, reject) => {
        timer = setTimeout(() => {
          control.aborted = true; // 同步标志，确保 willRetry/willDispatch 判不成立
          controller.abort(); // 熔断：run 级信号中止
          reject(
            new Error(
              `节点 "${node.id}" 执行超时：超过 ${timeoutMs}ms（timeout）`,
            ),
          );
        }, timeoutMs);
        p.then(
          (v) => {
            clearTimeout(timer);
            resolve(v);
          },
          (e) => {
            clearTimeout(timer);
            reject(e);
          },
        );
      });
    }

    // DPE：路由节点（if_else）仅命中 branch 的出边激活，其余出边传播 SKIPPED；非路由节点全部出边激活
    function isEdgeLive(
      source: WorkflowNode,
      output: NodeOutput | undefined,
      edge: WorkflowEdge,
    ): boolean {
      if (!BRANCH_ROUTE_TYPES.has(source.type)) return true;
      const branch =
        output && typeof output.branch === "string" ? output.branch : undefined;
      // 路由节点未上报 branch → 保守视为无命中分支：出边全部走 SKIPPED，避免 fork-join 死锁
      return typeof branch === "string" && edge.branch === branch;
    }

    // DPE 释放一条入边：live 记有效到达（validReceived），skip 只扣减待等待入度；
    // 扣减到零后按 OR-Join 语义派发，或（无任何有效入边）整节点跳过
    function release(
      sourceId: string,
      edge: WorkflowEdge,
      live: boolean,
    ): void {
      const targetId = edge.target;
      const w = (waiting.get(targetId) ?? 0) - 1;
      waiting.set(targetId, w);
      if (live) validReceived.add(targetId);
      if (w === 0) {
        if (validReceived.has(targetId)) dispatch(targetId);
        else skipNode(targetId);
      }
    }

    // DPE 跳过：全部入边 SKIPPED → 节点 status="skipped"；不执行 executor、不发 node_start，
    // 并继续向后继传播 SKIPPED 令牌
    function skipNode(targetId: string): void {
      const rec = nodeStates[targetId];
      if (rec.status !== "pending") return; // 已被 dispatch 或 skip 处理过
      rec.status = "skipped";
      rec.finishedAt = Date.now();
      emit("node_skip", targetId, { reason: "all_inputs_skipped" });
      completedCount++;
      for (const e of outEdges.get(targetId) ?? []) {
        release(targetId, e, false);
      }
    }

    function dispatch(nodeId: string): void {
      if (control.aborted) return;
      inflight++;

      queue.add(async () => {
        // S1: stop() 后积压在 p-queue 的任务不得再进入 running
        if (control.aborted) {
          inflight--;
          maybeFinish();
          return;
        }

        const node = nodes.get(nodeId)!;
        const rec = nodeStates[nodeId];

        try {
          rec.status = "running";
          rec.startedAt = Date.now();
          emit("node_start", nodeId);

          // retry 配置：number（max）或 { max|maxAttempts, backoffMs }
          const rawRetry = (node as { retry?: unknown }).retry;
          let maxRetries = 0;
          let backoffMs = 0;
          if (typeof rawRetry === "number") {
            maxRetries = rawRetry;
          } else if (rawRetry && typeof rawRetry === "object") {
            const rc = rawRetry as {
              max?: number;
              maxAttempts?: number;
              backoffMs?: number;
            };
            maxRetries = rc.max ?? rc.maxAttempts ?? 0;
            backoffMs = rc.backoffMs ?? 0;
          }
          const timeoutMs =
            (node as { timeoutMs?: number }).timeoutMs ?? defaultNodeTimeoutMs;

          // 尝试循环：attempt 从 1 起；maxRetries 为首次失败后的重试次数
          for (let attempt = 1; ; attempt++) {
            try {
              const executor = executors[node.type];
              if (!executor) {
                throw new Error(
                  `No executor registered for node type "${node.type}" (node "${nodeId}")`,
                );
              }

              // start 节点（工作流入口）注入运行输入；其余节点按声明 inputs 解析
              const nodeInputs =
                node.type === "start" ? { ...inputs } : resolveNodeInputs(node);
              const output = await execWithinTimeout(
                node,
                executor,
                nodeInputs,
                timeoutMs,
              );

              rec.status = "success";
              rec.finishedAt = Date.now();
              outputs[nodeId] = output;
              varCtx.set(nodeId, output);
              emit("node_finish", nodeId);
              break;
            } catch (e) {
              const errMsg = e instanceof Error ? e.message : String(e);
              const willRetry = !control.aborted && attempt - 1 < maxRetries;
              emit("node_error", nodeId, {
                error: errMsg,
                attempt,
                ...(willRetry ? { retrying: true } : {}),
              });
              if (!willRetry) {
                // 最终失败才置 failed
                rec.status = "failed";
                rec.finishedAt = Date.now();
                rec.error = errMsg;
                break;
              }
              await delay(backoffMs);
              if (control.aborted) {
                // 退避期间被 stop：放弃重试，按失败收尾（run 终态 stopped）
                rec.status = "failed";
                rec.finishedAt = Date.now();
                rec.error = errMsg;
                break;
              }
            }
          }
        } finally {
          // B5: 收尾逻辑（计数/后继释放/完结判定）包 try/finally 防泄漏
          completedCount++;
          inflight--;

          if (!control.aborted) {
            if (rec.status === "success") {
              const succs = outEdges.get(nodeId) ?? [];
              for (const e of succs) {
                release(nodeId, e, isEdgeLive(node, outputs[nodeId], e));
              }
            } else if (rec.status === "failed") {
              const onError = (node as { onError?: string }).onError;
              if (onError === "continue") {
                // onError "continue": 释放所有出边，下游继续执行（上游未注入变量池，引用失败节点会抛 WorkflowVarError）
                const succs = outEdges.get(nodeId) ?? [];
                for (const e of succs) {
                  release(nodeId, e, true);
                }
              }
              // onError "stop" (默认): 不传播，下游保持 pending
            }
          }

          maybeFinish();
        }
      });
    }

    // 播种：无入边的节点优先调度
    for (const n of snapshot.nodes) {
      if ((waiting.get(n.id) ?? 0) === 0) {
        dispatch(n.id);
      }
    }

    // 空图（无节点）直接完结
    if (inflight === 0) {
      maybeFinish();
    }

    await done;

    // ---- 清理 ----
    control.finishedAt = Date.now();
    emit("run_finish");

    // ---- 计算最终状态 ----
    let status: "success" | "failed" | "stopped";
    if (control.stopRequested) {
      // 仅用户 stop() 才置 stopped；超时熔断按失败收尾（failed）
      status = "stopped";
    } else {
      const hasFailed = Object.values(nodeStates).some(
        (s) => s.status === "failed",
      );
      status = hasFailed ? "failed" : "success";
    }
    control.status = status;

    this.runs.delete(runId);
    this.completedRuns.set(runId, control);
    if (this.completedRuns.size > 200) {
      const oldestKey = this.completedRuns.keys().next().value;
      if (oldestKey) this.completedRuns.delete(oldestKey);
    }

    return { runId, status, nodeStates, outputs, events };
  }

  /**
   * 停止指定 runId 的运行。
   * 设置中止标志，不再派发新任务；中止 run 级 AbortController，
   * 进行中的 executor 经 ctx.signal 可感知（executor 自行决定如何响应）。
   * 返回 true 表示该 run 存在且已被停止，false 表示不存在或已结束。
   */
  stop(runId: string): boolean {
    const state = this.runs.get(runId);
    if (!state) return false;
    state.aborted = true;
    state.stopRequested = true;
    state.status = "stopped";
    state.controller.abort();
    for (const pending of state.pendingHumans.values()) {
      pending.reject(new Error("Run stopped by user request"));
    }
    state.pendingHumans.clear();
    return true;
  }

  /**
   * 查询指定 runId 的状态。
   */
  status(runId: string): {
    runId: string;
    workflowName: string;
    status: RunStatus;
    startedAt: number;
    finishedAt?: number;
    nodes: Array<{ id: string; status: NodeStatus; startedAt?: number; finishedAt?: number; error?: string }>;
    nodeStates: Record<string, NodeState>;
  } | undefined {
    const control = this.runs.get(runId) ?? this.completedRuns.get(runId);
    if (!control) return undefined;
    return {
      runId: control.runId,
      workflowName: control.workflowName,
      status: control.status,
      startedAt: control.startedAt,
      finishedAt: control.finishedAt,
      nodes: Object.entries(control.nodeStates).map(([id, s]) => ({
        id,
        status: s.status,
        startedAt: s.startedAt,
        finishedAt: s.finishedAt,
        error: s.error,
      })),
      nodeStates: control.nodeStates,
    };
  }

  /**
   * 向挂起的 human 节点提交审批决策。
   */
  approve(
    runId: string,
    nodeId: string,
    decision: "approved" | "rejected" | string,
    inputs?: Record<string, JsonValue>,
  ): { nodeId: string; decision: string; resumed: boolean } {
    const control = this.runs.get(runId);
    if (!control) {
      return { nodeId, decision, resumed: false };
    }
    const pending = control.pendingHumans.get(nodeId);
    if (!pending) {
      return { nodeId, decision, resumed: false };
    }
    control.pendingHumans.delete(nodeId);
    if (control.pendingHumans.size === 0 && control.status === "waiting_human") {
      control.status = "running";
    }
    control.nodeStates[nodeId].status = "running";
    pending.resolve({ decision, inputs });
    return { nodeId, decision, resumed: true };
  }

  /**
   * 从内存态恢复挂起的 run。
   */
  resume(runId: string): {
    resumed: boolean;
    nodes: Array<{ id: string; status: NodeStatus }>;
  } {
    const control = this.runs.get(runId);
    if (!control) {
      return { resumed: false, nodes: [] };
    }
    return {
      resumed: true,
      nodes: Object.entries(control.nodeStates).map(([id, s]) => ({
        id,
        status: s.status,
      })),
    };
  }
}
