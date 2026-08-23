/** 开始 节点局部类型。 */
import type { WorkflowNode } from "@dsh-workflow/schema";

export type StartNode = Extract<WorkflowNode, { type: "start" }>;
