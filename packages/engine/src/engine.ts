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

export interface ExecutionContext {
  runId: string;
  nodeId: string;
  signal: AbortSignal;
  log(event: RunEvent): void;
  varCtx: VariableContext;
  callStack?: string[];
  host: {
    tools: unknown;
    llm: unknown;
    subagents: unknown;
    codeRuntime: unknown;
  };
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

export type RunStatus = "success" | "failed" | "stopped";

export interface RunResult {
  runId: string;
  status: RunStatus;
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
  host?: {
    tools?: unknown;
    llm?: unknown;
    subagents?: unknown;
    codeRuntime?: unknown;
  };
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

interface RunControl {
  aborted: boolean;
  stopRequested: boolean;
  controller: AbortController;
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
    const runId = crypto.randomUUID();
    const controller = new AbortController();
    const control: RunControl = { aborted: false, stopRequested: false, controller };
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

    // 节点状态
    const nodeStates: Record<string, NodeState> = {};
    for (const n of snapshot.nodes) {
      nodeStates[n.id] = { status: "pending" };
    }

    const outputs: Record<string, NodeOutput> = {};
    const events: RunEvent[] = [];
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
      events.push({ timestamp: Date.now(), runId, type, nodeId, data });
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

    const makeCtx = (nodeId: string): ExecutionContext => ({
      runId,
      nodeId,
      signal: controller.signal,
      log: (ev: RunEvent) => {
        events.push({ ...ev, runId, timestamp: Date.now() });
      },
      varCtx,
      host: this.host,
    });

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

          if (!control.aborted && rec.status === "success") {
            const succs = outEdges.get(nodeId) ?? [];
            for (const e of succs) {
              release(nodeId, e, isEdgeLive(node, outputs[nodeId], e));
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
    this.runs.delete(runId);
    emit("run_finish");

    // ---- 计算最终状态 ----
    let status: RunStatus;
    if (control.stopRequested) {
      // 仅用户 stop() 才置 stopped；超时熔断按失败收尾（failed）
      status = "stopped";
    } else {
      const hasFailed = Object.values(nodeStates).some(
        (s) => s.status === "failed",
      );
      status = hasFailed ? "failed" : "success";
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
    state.controller.abort();
    return true;
  }
}
