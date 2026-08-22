import { Graph } from "graphlib";
import PQueue from "p-queue";
import crypto from "node:crypto";
import {
  validateWorkflow,
  WorkflowDSL,
  WorkflowNode,
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
  controller: AbortController;
}

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
  private readonly host: ExecutionContext["host"];
  private readonly runs = new Map<string, RunControl>();

  constructor(
    executors: Record<NodeType, NodeExecutor>,
    options: EngineOptions = {},
  ) {
    this.executors = executors;
    this.maxParallelNodes = options.maxParallelNodes ?? 8;
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
   */
  async run(
    dsl: WorkflowDSL,
    inputs: Record<string, JsonValue>,
  ): Promise<RunResult> {
    // ---- 前置校验 ----
    const validationResult = validateWorkflow(dsl);
    if (!validationResult.ok) {
      throw new WorkflowValidationError(validationResult);
    }

    // ---- 运行初始化 ----
    const runId = crypto.randomUUID();
    const controller = new AbortController();
    const control: RunControl = { aborted: false, controller };
    this.runs.set(runId, control);

    const nodes = new Map(dsl.nodes.map((n) => [n.id, n]));

    // 建 DAG
    const graph = new Graph({ directed: true, multigraph: true });
    for (const n of dsl.nodes) {
      graph.setNode(n.id, n);
    }
    for (const e of dsl.edges) {
      graph.setEdge(e.source, e.target, e.id);
    }

    // 入度（按唯一前置节点数，而非边数）
    const inDegree = new Map<string, number>();
    for (const n of dsl.nodes) {
      inDegree.set(n.id, (graph.predecessors(n.id) ?? []).length);
    }

    // 节点状态
    const nodeStates: Record<string, NodeState> = {};
    for (const n of dsl.nodes) {
      nodeStates[n.id] = { status: "pending" };
    }

    const outputs: Record<string, NodeOutput> = {};
    const events: RunEvent[] = [];
    const varCtx = new VariableContext();
    const startNode = dsl.nodes.find((n) => n.type === "start");
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
    const totalCount = dsl.nodes.length;

    const emit = (
      type: RunEvent["type"],
      nodeId?: string,
      data?: Record<string, JsonValue>,
    ) => {
      events.push({ timestamp: Date.now(), runId, type, nodeId, data });
    };
    emit("run_start");

    // 是否存在仍可派发的节点（pending 且入度已归零）
    const hasRunnable = () =>
      dsl.nodes.some(
        (n) =>
          nodeStates[n.id].status === "pending" &&
          (inDegree.get(n.id) ?? 1) === 0,
      );

    const maybeFinish = () => {
      // 无在途任务且（全部完成 / 已中止 / 无任何节点可再派发，如失败传播导致下游永久阻塞）即完结
      if (inflight === 0 && (completedCount === totalCount || control.aborted || !hasRunnable())) {
        resolveDone();
      }
    };

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

    const dispatch = (nodeId: string) => {
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

          try {
            const executor = this.executors[node.type];
            if (!executor) {
              throw new Error(
                `No executor registered for node type "${node.type}" (node "${nodeId}")`,
              );
            }

            // start 节点（工作流入口）注入运行输入；其余节点按声明 inputs 解析
            const nodeInputs = node.type === "start" ? { ...inputs } : resolveNodeInputs(node);
            const output = await executor.execute(
              node,
              nodeInputs,
              makeCtx(nodeId),
            );

            rec.status = "success";
            rec.finishedAt = Date.now();
            outputs[nodeId] = output;
            varCtx.set(nodeId, output);
            emit("node_finish", nodeId);
          } catch (e) {
            rec.status = "failed";
            rec.finishedAt = Date.now();
            rec.error = e instanceof Error ? e.message : String(e);
            emit("node_error", nodeId, { error: rec.error });
          }
        } finally {
          // B5: 收尾逻辑（计数/后继释放/完结判定）包 try/finally 防泄漏
          completedCount++;
          inflight--;

          if (rec.status === "success" && !control.aborted) {
            const succs = graph.successors(nodeId) ?? [];
            for (const succ of succs) {
              const d = (inDegree.get(succ) ?? 1) - 1;
              inDegree.set(succ, d);
              if (d === 0) {
                dispatch(succ);
              }
            }
          }

          maybeFinish();
        }
      });
    };

    // 播种：无入度的节点优先调度
    for (const n of dsl.nodes) {
      if ((inDegree.get(n.id) ?? 0) === 0) {
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
    if (control.aborted) {
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
   * 设置中止标志，不再派发新任务；已在运行中的节点继续执行（T4b 扩展 AbortSignal 传播）。
   * 返回 true 表示该 run 存在且已被停止，false 表示不存在或已结束。
   */
  stop(runId: string): boolean {
    const state = this.runs.get(runId);
    if (!state) return false;
    state.aborted = true;
    state.controller.abort();
    return true;
  }
}
