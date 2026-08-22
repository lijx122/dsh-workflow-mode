import type { NodeExecutor, NodeOutput } from "../engine.js";
import type { StartNode } from "@dsh-workflow/schema";

/**
 * start：工作流入口。引擎在调度时已把 run 级 inputs 注入本节点；
 * 执行器将 inputs 原样透传，作为后续变量引用的根。
 */
export const startExecutor: NodeExecutor = {
  type: "start",
  async execute(
    _node: StartNode,
    inputs: Record<string, NodeOutput[string]>,
  ): Promise<NodeOutput> {
    return { ...inputs };
  },
};
