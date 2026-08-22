import type { NodeExecutor, NodeOutput } from "../engine.js";
import type { SubagentNode } from "@dsh-workflow/schema";
import { NotImplementedError } from "./errors.js";

/**
 * subagent：子代理节点（stub）。
 * DSH host 服务绑定（subagents 注册表）属 T6，本棒仅保持注册表完整。
 */
export const subagentExecutor: NodeExecutor = {
  type: "subagent",
  async execute(
    _node: SubagentNode,
    _inputs: Record<string, NodeOutput[string]>,
  ): Promise<NodeOutput> {
    throw new NotImplementedError("T6 binds DSH services (subagents)");
  },
};
