/** llm 节点局部类型：temperature 以 UI 扩展字段存放于 inputs.temperature（§10.1 假设，M3 消费）。 */
import type { WorkflowNode } from "@dsh-workflow/schema";

export type LlmNode = Extract<WorkflowNode, { type: "llm" }>;

export interface LlmInputsView extends Record<string, unknown> {
  /** 采样温度 0-1（UI 扩展字段）。 */
  temperature?: number;
}
