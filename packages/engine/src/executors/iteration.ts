import PQueue from "p-queue";
import type { NodeExecutor, NodeOutput } from "../engine.js";
import type { ExecutionContext } from "../engine.js";
import type { IterationNode, WorkflowNode } from "@dsh-workflow/schema";

const DEFAULT_MAX_ITERATIONS = 500;
const DEFAULT_MAX_CONCURRENCY = 5;

/**
 * 获取迭代器执行器（由此棒注入，避免循环依赖）。
 */
let _executorResolver: ((type: string) => NodeExecutor | undefined) | null = null;

export function setExecutorResolver(
  resolver: (type: string) => NodeExecutor | undefined,
): void {
  _executorResolver = resolver;
}

/**
 * iteration：遍历数组，对每项执行 body 内节点并聚合输出。
 *
 * node.over 为变量引用（如 "{{#start.items}}"），解析为数组。
 * node.maxIterations 默认 500，超限抛错。
 * node.maxConcurrency 默认 5，用 p-queue 限流。
 * node.body 支持两种形态：
 *   ① 节点数组（线性执行，无内部连线）
 *   ② { nodes, edges }（本棒 edges 忽略——见 T10 增强；仅按 nodes 线性执行）
 * 聚合每次迭代输出为 outputs.items 数组。
 *
 * 3c：PQueue 并发语义——最坏在飞（同时执行）数量 ≈ 引擎并发 × maxConcurrency。
 * 任一迭代失败后调用 queue.clear() 阻止已入队任务继续空转，仅已在飞任务跑完。
 */
export const iterationExecutor: NodeExecutor = {
  type: "iteration",
  async execute(
    node: IterationNode,
    _inputs: Record<string, NodeOutput[string]>,
    ctx: ExecutionContext,
  ): Promise<NodeOutput> {
    // 解析 over 为数组
    const overVal = ctx.varCtx.ref(node.over);
    if (!Array.isArray(overVal)) {
      throw new Error(
        `iteration "${ctx.nodeId}": over "${node.over}" 解析结果不是数组，实际为 ${typeof overVal}`,
      );
    }
    const items = overVal as unknown[];

    const maxIter = node.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    if (items.length > maxIter) {
      throw new Error(
        `iteration "${ctx.nodeId}": 迭代次数 ${items.length} 超过最大限制 ${maxIter}`,
      );
    }

    const concurrency = node.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;

    // 解析 body
    const bodyNodes = resolveBody(node.body, ctx.nodeId);
    if (bodyNodes.length === 0) {
      return { items: [] };
    }

    // 获取 executor 解析器
    const resolver = _executorResolver;
    if (!resolver) {
      throw new Error(
        `iteration "${ctx.nodeId}": executor resolver 未注入`,
      );
    }

    const queue = new PQueue({ concurrency });

    // 将每项迭代加入队列
    const iterationResults: Promise<NodeOutput | null>[] = items.map(
      (item, index) =>
        queue.add(async () => {
          if (ctx.signal.aborted) return null;

          // 为本次迭代创建上下文输入：_item 与 _index
          const iterInputs: Record<string, NodeOutput[string]> = {
            _item: item as NodeOutput[string],
            _index: index,
          };

          // 线性执行 body 节点
          let lastOutput: NodeOutput | null = null;
          for (const bodyNode of bodyNodes) {
            if (ctx.signal.aborted) return null;

            const executor = resolver(bodyNode.type);
            if (!executor) {
              throw new Error(
                `iteration "${ctx.nodeId}": body 节点 "${bodyNode.id}" 类型 "${bodyNode.type}" 无注册执行器`,
              );
            }

            // 首个节点注入 iterInputs，后续节点注入前一节点输出
            const nodeInputs = lastOutput ?? { ...iterInputs };
            const resolvedInputs = resolveNodeInputs(bodyNode, ctx, nodeInputs);

            lastOutput = await executor.execute(bodyNode, resolvedInputs, ctx);
          }
          return lastOutput;
        }),
    );

    // 3c：任一迭代失败即清理队列，阻止已入队任务继续空转；
    // 已在飞的任务（最多 concurrency 个）继续跑完
    const results = await Promise.all(
      iterationResults.map((p) =>
        p.catch((err) => {
          queue.clear();
          throw err;
        }),
      ),
    );
    const itemsOutput = results.filter((r): r is NodeOutput => r !== null);

    return { items: itemsOutput };
  },
};

/**
 * 解析 body 为节点数组。仅支持两种形态（S3）：
 * ① 节点数组（线性顺序映射，无内部连线）
 * ② { nodes, edges }（本棒 edges 忽略，仅按 nodes 线性执行；
 *    T10 增强将支持 edges 驱动的内部连线——见 schema 注释 D4）
 * 其余形状（含单节点对象、null/undefined 等）一律抛错，不再静默返回空结果。
 */
function resolveBody(body: unknown, nodeId: string): WorkflowNode[] {
  // 形态①：节点数组
  if (Array.isArray(body)) {
    return body as WorkflowNode[];
  }
  // 形态②：{ nodes, edges }
  if (body !== null && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    if (Array.isArray(obj.nodes)) {
      if (Array.isArray(obj.edges) && obj.edges.length > 0) {
        console.warn(
          `iteration "${nodeId}": body 携带 ${obj.edges.length} 条 edges，本棒仍忽略（T10 增强），仅按 nodes 线性执行`,
        );
      }
      return obj.nodes as WorkflowNode[];
    }
  }
  const shape = body === null ? "null" : typeof body;
  throw new Error(
    `iteration "${nodeId}": body 必须是节点数组或 { nodes, edges } 对象，实际为 ${shape}`,
  );
}

/**
 * 解析 body 节点自身的 inputs 声明：inputs 中的字符串值经 varCtx.ref() 解析
 * （占位符保型 / 字面量直通），非字符串值原样透传。
 */
function resolveNodeInputs(
  bodyNode: WorkflowNode,
  ctx: ExecutionContext,
  iterInputs: Record<string, NodeOutput[string]>,
): Record<string, NodeOutput[string]> {
  const raw = (bodyNode as Record<string, unknown>).inputs;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...iterInputs };
  }
  const resolved: Record<string, NodeOutput[string]> = { ...iterInputs };
  for (const [key, rawVal] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof rawVal === "string") {
      resolved[key] = ctx.varCtx.ref(rawVal);
    } else {
      resolved[key] = rawVal as NodeOutput[string];
    }
  }
  return resolved;
}
