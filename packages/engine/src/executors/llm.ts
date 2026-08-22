import type { NodeExecutor, NodeOutput } from "../engine.js";
import type { LLMNode } from "@dsh-workflow/schema";
import { NotImplementedError } from "./errors.js";

/**
 * llm：大模型调用节点（stub）。
 * DSH host 服务绑定（dsh-llm）属 T6，本棒仅保持注册表完整。
 */
export const llmExecutor: NodeExecutor = {
  type: "llm",
  async execute(
    _node: LLMNode,
    _inputs: Record<string, NodeOutput[string]>,
  ): Promise<NodeOutput> {
    throw new NotImplementedError("T6 binds DSH services (llm/dsh-llm)");
  },
};
