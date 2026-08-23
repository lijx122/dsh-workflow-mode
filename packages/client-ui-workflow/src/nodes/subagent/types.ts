/** subagent 节点局部类型：workspace 为 UI 扩展字段（存于 inputs.workspace，§10 P0-2 显式指定创建）。 */
import type { WorkflowNode } from "@dsh-workflow/schema";

export type SubagentNode = Extract<WorkflowNode, { type: "subagent" }>;

export interface SubagentInputsView extends Record<string, unknown> {
  /** 工作区选择器值（含子 Agent 文件夹），M3 session-executor 显式指定。 */
  workspace?: string;
}
