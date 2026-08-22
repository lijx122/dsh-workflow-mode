import type { NodeExecutor, NodeOutput } from "../engine.js";
import type { HumanNode } from "@dsh-workflow/schema";
import { NotImplementedError } from "./errors.js";

/**
 * human：人机交互断点节点（stub）。
 * DSH host 服务绑定（tools/ask-user 通道）属 T6，本棒仅保持注册表完整。
 */
export const humanExecutor: NodeExecutor = {
  type: "human",
  async execute(
    _node: HumanNode,
    _inputs: Record<string, NodeOutput[string]>,
  ): Promise<NodeOutput> {
    throw new NotImplementedError("T6 binds DSH services (human/ask-user)");
  },
};
