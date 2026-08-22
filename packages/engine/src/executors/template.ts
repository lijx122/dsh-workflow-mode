import type { NodeExecutor, NodeOutput } from "../engine.js";
import type { ExecutionContext } from "../engine.js";
import type { TemplateNode } from "@dsh-workflow/schema";

/**
 * template：占位符插值渲染。
 * 对 node.template 做 varCtx.interpolate() 替换所有 {{#nodeId.prop}} 占位符，
 * 输出 { result }。
 */
export const templateExecutor: NodeExecutor = {
  type: "template",
  async execute(
    node: TemplateNode,
    _inputs: Record<string, NodeOutput[string]>,
    ctx: ExecutionContext,
  ): Promise<NodeOutput> {
    const result = ctx.varCtx.interpolate(node.template);
    return { result };
  },
};
