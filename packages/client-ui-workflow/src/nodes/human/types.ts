/** 人工审批 节点局部类型。 */
import type { WorkflowNode } from "@dsh-workflow/schema";

export type HumanNode = Extract<WorkflowNode, { type: "human" }>;
