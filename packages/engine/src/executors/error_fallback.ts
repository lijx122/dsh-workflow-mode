import type { NodeExecutor, NodeOutput } from "../engine.js";
import type { ExecutionContext } from "../engine.js";
import type { ErrorFallbackNode } from "@dsh-workflow/schema";

/**
 * error_fallback：错误回退节点。
 * 透传上游失败节点经 onError:"route" 注入的错误转储（inputs.error / inputs.errorNode）。
 */
export const errorFallbackExecutor: NodeExecutor = {
  type: "error_fallback",
  async execute(
    _node: ErrorFallbackNode,
    inputs: Record<string, NodeOutput[string]>,
    _ctx: ExecutionContext,
  ): Promise<NodeOutput> {
    return {
      error: inputs.error ?? null,
      errorNode: inputs.errorNode ?? null,
      handled: true,
      ...inputs,
    };
  },
};
