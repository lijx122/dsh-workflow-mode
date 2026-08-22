import type { NodeExecutor, NodeOutput } from "../engine.js";
import type { PluginToolNode } from "@dsh-workflow/schema";
import { NotImplementedError } from "./errors.js";

/**
 * plugin_tool：DSH 工具注册表反射调用节点（stub）。
 * DSH host 服务绑定（tools 注册表）属 T6，本棒仅保持注册表完整。
 */
export const pluginToolExecutor: NodeExecutor = {
  type: "plugin_tool",
  async execute(
    _node: PluginToolNode,
    _inputs: Record<string, NodeOutput[string]>,
  ): Promise<NodeOutput> {
    throw new NotImplementedError("T6 binds DSH services (plugin_tool/tools registry)");
  },
};
