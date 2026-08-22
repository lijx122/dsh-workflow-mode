import type { NodeExecutor, NodeOutput } from "../engine.js";
import type { ExecutionContext } from "../engine.js";
import type { EndNode } from "@dsh-workflow/schema";

/**
 * end：收集 outputs 引用为 run 级最终输出。
 * node.outputs 为 { key: "{{#nodeId.prop}}" } 形式的变量引用字典；
 * 每项通过 varCtx.ref() 解析为原始值。
 */
export const endExecutor: NodeExecutor = {
  type: "end",
  async execute(
    node: EndNode,
    _inputs: Record<string, NodeOutput[string]>,
    ctx: ExecutionContext,
  ): Promise<NodeOutput> {
    const refs = node.outputs ?? {};
    const output: NodeOutput = {};
    for (const [key, ref] of Object.entries(refs)) {
      output[key] = ctx.varCtx.ref(ref);
    }
    return output;
  },
};
