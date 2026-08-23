/** 合并 节点局部类型。 */
import type { WorkflowNode } from "@dsh-workflow/schema";

export type MergeNode = Extract<WorkflowNode, { type: "merge" }>;
