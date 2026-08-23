/** 变量赋值 节点局部类型。 */
import type { WorkflowNode } from "@dsh-workflow/schema";

export type SetVariableNode = Extract<WorkflowNode, { type: "set_variable" }>;
