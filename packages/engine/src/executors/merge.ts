import type { NodeExecutor, NodeOutput } from "../engine.js";
import type { ExecutionContext } from "../engine.js";
import type { JsonValue } from "../variable-context.js";
import type { MergeNode } from "@dsh-workflow/schema";

function deepMerge(target: unknown, source: unknown): unknown {
  if (
    typeof target !== "object" ||
    target === null ||
    typeof source !== "object" ||
    source === null ||
    Array.isArray(target) ||
    Array.isArray(source)
  ) {
    return source;
  }
  const result: Record<string, unknown> = { ...(target as Record<string, unknown>) };
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    if (
      key in result &&
      typeof result[key] === "object" &&
      result[key] !== null &&
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(result[key]) &&
      !Array.isArray(value)
    ) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * merge：多前驱节点输出聚合器。
 * 聚合全部前驱节点输出，按 key 归并（默认 shallow，可选 deep）。
 */
export const mergeExecutor: NodeExecutor = {
  type: "merge",
  async execute(
    node: MergeNode,
    inputs: Record<string, NodeOutput[string]>,
    ctx: ExecutionContext,
  ): Promise<NodeOutput> {
    const strategy = node.strategy ?? "shallow";
    const predecessors = Array.isArray(inputs._predecessors)
      ? (inputs._predecessors as string[])
      : [];

    let merged: Record<string, JsonValue> = {};

    for (const predId of predecessors) {
      const predOutputs = ctx.varCtx.getNodeOutputs(predId);
      if (predOutputs) {
        if (strategy === "deep") {
          merged = deepMerge(merged, predOutputs) as Record<string, JsonValue>;
        } else {
          merged = { ...merged, ...predOutputs };
        }
      }
    }

    // 合并节点自身显式 inputs（除去内部 _predecessors）
    for (const [k, v] of Object.entries(inputs)) {
      if (k === "_predecessors") continue;
      merged[k] = v;
    }

    return merged;
  },
};
