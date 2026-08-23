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
import { switchExecutor } from "./switch.js";
import { waitExecutor } from "./wait.js";
import { mergeExecutor } from "./merge.js";
import { errorFallbackExecutor } from "./error_fallback.js";
import { scheduleTriggerExecutor } from "./schedule_trigger.js";
import { webhookTriggerExecutor } from "./webhook_trigger.js";
import { intentClassifierExecutor } from "./intent_classifier.js";
import { parameterExtractorExecutor } from "./parameter_extractor.js";
import { subWorkflowExecutor } from "./sub_workflow.js";
import { httpRequestExecutor } from "./http_request.js";

/**
 * 创建完整执行器注册表（21 种 NodeType 全覆盖）。
 */
export function createExecutors(): Record<NodeType, NodeExecutor> {
  const registry: Record<NodeType, NodeExecutor> = {
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
    switch: switchExecutor,
    wait: waitExecutor,
    merge: mergeExecutor,
    error_fallback: errorFallbackExecutor,
    schedule_trigger: scheduleTriggerExecutor,
    webhook_trigger: webhookTriggerExecutor,
    intent_classifier: intentClassifierExecutor,
    parameter_extractor: parameterExtractorExecutor,
    sub_workflow: subWorkflowExecutor,
    http_request: httpRequestExecutor,
  };

  // 将 iteration 的 body 解析器注入
  setExecutorResolver((type: string) => registry[type as NodeType] as NodeExecutor | undefined);

  return registry;
}

export {
  startExecutor,
  endExecutor,
  ifElseExecutor,
  iterationExecutor,
  templateExecutor,
  setVariableExecutor,
  codeExecutor,
  humanExecutor,
  llmExecutor,
  subagentExecutor,
  pluginToolExecutor,
  switchExecutor,
  waitExecutor,
  mergeExecutor,
  errorFallbackExecutor,
  scheduleTriggerExecutor,
  webhookTriggerExecutor,
  intentClassifierExecutor,
  parameterExtractorExecutor,
  subWorkflowExecutor,
  httpRequestExecutor,
};

export { NotImplementedError, hostNotBound } from "./errors.js";