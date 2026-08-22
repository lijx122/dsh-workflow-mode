import type { NodeExecutor, NodeOutput } from "../engine.js";
import type { ExecutionContext } from "../engine.js";
import type { IfElseNode } from "@dsh-workflow/schema";

/**
 * if_else：条件分支路由节点。
 * 对 node.condition 做表达式上下文求值，结果 truthy → { branch: "true" }，
 * 否则 { branch: "false" }。
 * 引擎按 branch 值激活命中出边（edge.branch === "true"/"false"），
 * 未命中分支传播 SKIPPED 令牌（DPE 死路径消除）。
 */
export const ifElseExecutor: NodeExecutor = {
  type: "if_else",
  async execute(
    node: IfElseNode,
    _inputs: Record<string, NodeOutput[string]>,
    ctx: ExecutionContext,
  ): Promise<NodeOutput> {
    const result = ctx.varCtx.evalExpr(node.condition);
    const branch = result ? "true" : "false";
    return { branch };
  },
};
