import type { NodeExecutor, NodeOutput } from "../engine.js";
import type { ExecutionContext } from "../engine.js";
import type { SwitchNode } from "@dsh-workflow/schema";

/**
 * switch：多路条件分支路由节点。
 * 遍历 node.cases 依次求值，命中首个 case 后输出 { branch: 命中值 }；
 * 未命中任何 case 时回退到 defaultCase / default / "default"。
 * 引擎根据 branch 激活命中出边（edge.branch 或 edge.sourceHandle 匹配），其余出边传播 SKIPPED 令牌（DPE）。
 */
export const switchExecutor: NodeExecutor = {
  type: "switch",
  async execute(
    node: SwitchNode,
    _inputs: Record<string, NodeOutput[string]>,
    ctx: ExecutionContext,
  ): Promise<NodeOutput> {
    const cases = Array.isArray(node.cases) ? node.cases : [];

    let matchedBranch: string | undefined;

    for (let i = 0; i < cases.length; i++) {
      const c = cases[i];
      if (typeof c === "string") {
        if (node.expression) {
          const exprVal = ctx.varCtx.evalExpr(node.expression);
          if (String(exprVal) === c) {
            matchedBranch = c;
            break;
          }
        } else {
          const res = ctx.varCtx.evalExpr(c);
          if (res) {
            matchedBranch = c;
            break;
          }
        }
      } else if (c && typeof c === "object") {
        const expr = c.when ?? c.condition;
        if (expr) {
          const res = ctx.varCtx.evalExpr(expr);
          if (res) {
            matchedBranch = c.value ?? c.target ?? expr;
            break;
          }
        } else if (c.value && node.expression) {
          const exprVal = ctx.varCtx.evalExpr(node.expression);
          if (String(exprVal) === c.value) {
            matchedBranch = c.value;
            break;
          }
        }
      }
    }

    if (matchedBranch === undefined) {
      matchedBranch = node.defaultCase ?? node.default ?? "default";
    }

    return { branch: matchedBranch };
  },
};
