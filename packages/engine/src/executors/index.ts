import type { NodeExecutor } from "../engine.js";
import type { NodeType } from "@dsh-workflow/schema";
import { startExecutor } from "./start.js";
import { endExecutor } from "./end.js";
import { ifElseExecutor } from "./if_else.js";
import { iterationExecutor, setExecutorResolver } from "./iteration.js";
import { templateExecutor } from "./template.js";
import { setVariableExecutor } from "./set_variable.js";
import { codeExecutor } from "./code.js";
import { humanExecutor } from "./human.js";
import { llmExecutor } from "./llm.js";
import { subagentExecutor } from "./subagent.js";
import { pluginToolExecutor } from "./plugin_tool.js";
import { NotImplementedError } from "./errors.js";

// P1 暂未实现的默认桩
const p1Stub = (type: string): NodeExecutor => ({
  type: type as NodeType,
  execute: async () => {
    throw new NotImplementedError(`P1 node type "${type}" not yet implemented`);
  },
});

const P1_TYPES: NodeType[] = [
  "switch", "wait", "merge", "error_fallback",
  "schedule_trigger", "webhook_trigger",
  "intent_classifier", "parameter_extractor",
  "sub_workflow", "http_request",
];

/**
 * 创建完整执行器注册表（21 种 NodeType，含 P0 可执行 + P1 桩）。
 * P0 7 种纯逻辑执行器（start/end/if_else/template/set_variable/code/iteration）
 * 使用真实实现；P0 4 种 DSH 集成节点（human/llm/subagent/plugin_tool）抛出 NotImplementedError；
 * P1 10 种抛出 NotImplementedError。
 */
export function createExecutors(): Record<NodeType, NodeExecutor> {
  const registry: Record<string, NodeExecutor> = {
    start: startExecutor,
    end: endExecutor,
    if_else: ifElseExecutor,
    iteration: iterationExecutor,
    template: templateExecutor,
    set_variable: setVariableExecutor,
    code: codeExecutor,
    human: humanExecutor,
    llm: llmExecutor,
    subagent: subagentExecutor,
    plugin_tool: pluginToolExecutor,
  };

  for (const t of P1_TYPES) {
    registry[t] = p1Stub(t);
  }

  // 将 iteration 的 body 解析器注入
  setExecutorResolver((type: string) => registry[type] as NodeExecutor | undefined);

  return registry as Record<NodeType, NodeExecutor>;
}

export { NotImplementedError } from "./errors.js";
