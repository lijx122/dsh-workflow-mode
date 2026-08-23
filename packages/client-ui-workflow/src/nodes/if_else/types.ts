/** 条件分支 节点局部类型。 */
import type { WorkflowNode } from "@dsh-workflow/schema";

export type IfElseNode = Extract<WorkflowNode, { type: "if_else" }>;
