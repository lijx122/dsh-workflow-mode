/** 多路分支 节点局部类型。 */
import type { WorkflowNode } from "@dsh-workflow/schema";

export type SwitchNode = Extract<WorkflowNode, { type: "switch" }>;
