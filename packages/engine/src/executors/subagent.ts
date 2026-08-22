import type { NodeExecutor, NodeOutput } from "../engine.js";
import type { ExecutionContext } from "../engine.js";
import type { SubagentNode } from "@dsh-workflow/schema";
import { hostNotBound } from "./errors.js";

/**
 * subagent：子代理一次性调用节点。
 *
 * 契约：
 * - 调 host.subagents.spawn({ prompt: 插值后, preset? })
 * - 返回 { result }（结构化回收）
 * - host.subagents 缺失 → 抛 hostNotBound("subagents")
 */
export const subagentExecutor: NodeExecutor = {
  type: "subagent",
  async execute(
    node: SubagentNode,
    _inputs: Record<string, NodeOutput[string]>,
    ctx: ExecutionContext,
  ): Promise<NodeOutput> {
    const subagents = ctx.host.subagents;
    if (!subagents) {
      throw hostNotBound("subagents");
    }

    const prompt = ctx.varCtx.interpolate(node.prompt);

    const outcome = await subagents.spawn({
      prompt,
      preset: node.preset,
    });

    return { result: outcome.result };
  },
};
