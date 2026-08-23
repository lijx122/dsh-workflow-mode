/** 代码执行 节点局部类型。 */
import type { WorkflowNode } from "@dsh-workflow/schema";

export type CodeNode = Extract<WorkflowNode, { type: "code" }>;
