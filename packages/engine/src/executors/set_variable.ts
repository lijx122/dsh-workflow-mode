import type { NodeExecutor, NodeOutput } from "../engine.js";
import type { ExecutionContext } from "../engine.js";
import type { SetVariableNode } from "@dsh-workflow/schema";

/**
 * set_variable：按 node.assignments 数组顺序写变量池。
 * 每项 value 经 varCtx.ref() 解析：恰为占位符时返回原始 JsonValue（保型），
 * 否则作为字面量原样写入。输出为写入的全部键值对。
 * 引擎在节点成功后自动将输出写入 Run 级变量池（varCtx.set(nodeId, output)），
 * 后续节点即可经 {{#nodeId.key}} 引用。
 */
export const setVariableExecutor: NodeExecutor = {
  type: "set_variable",
  async execute(
    node: SetVariableNode,
    _inputs: Record<string, NodeOutput[string]>,
    ctx: ExecutionContext,
  ): Promise<NodeOutput> {
    const output: NodeOutput = {};
    for (const { key, value } of node.assignments ?? []) {
      output[key] = ctx.varCtx.ref(value);
    }
    return output;
  },
};
