import type { NodeExecutor, NodeOutput } from "../engine.js";
import type { ExecutionContext } from "../engine.js";
import type { PluginToolNode } from "@dsh-workflow/schema";
import { hostNotBound } from "./errors.js";

/**
 * plugin_tool：DSH 工具注册表反射调用节点。
 *
 * 契约：
 * - 调 host.tools.invoke(toolName, { ...inputs, action? })，action 以 node.action 权威
 * - 返回值原样透传为节点输出（不包装 { result }，保持工具返回结构）
 * - 工具不存在（host.tools.has 校验失败 / invoke reject）→ 抛错
 * - host.tools 缺失 → 抛 hostNotBound("tools")
 */
export const pluginToolExecutor: NodeExecutor = {
  type: "plugin_tool",
  async execute(
    node: PluginToolNode,
    inputs: Record<string, NodeOutput[string]>,
    ctx: ExecutionContext,
  ): Promise<NodeOutput> {
    const tools = ctx.host.tools;
    if (!tools) {
      throw hostNotBound("tools");
    }

    // 前置存在性检查（可选通道）：工具不存在时给出明确报错
    if (typeof tools.has === "function" && !tools.has(node.toolName)) {
      throw new Error(
        `plugin_tool node "${ctx.nodeId}": tool "${node.toolName}" not found in host tools registry`,
      );
    }

    // 组装参数：{ ...inputs, action? }，node.action 权威（覆盖 inputs.action）
    const args: Record<string, NodeOutput[string]> = { ...(inputs ?? {}) };
    if (node.action !== undefined && node.action !== null) {
      args.action = node.action as NodeOutput[string];
    }

    const output = await tools.invoke(node.toolName, args);
    return output as NodeOutput;
  },
};
