/** 循环 节点局部类型。 */
import type { WorkflowNode } from "@dsh-workflow/schema";

export type IterationNode = Extract<WorkflowNode, { type: "iteration" }>;
