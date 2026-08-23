/** 结束 节点局部类型。 */
import type { WorkflowNode } from "@dsh-workflow/schema";

export type EndNode = Extract<WorkflowNode, { type: "end" }>;
