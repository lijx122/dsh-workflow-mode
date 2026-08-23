/** 文本模板 节点局部类型。 */
import type { WorkflowNode } from "@dsh-workflow/schema";

export type TemplateNode = Extract<WorkflowNode, { type: "template" }>;
