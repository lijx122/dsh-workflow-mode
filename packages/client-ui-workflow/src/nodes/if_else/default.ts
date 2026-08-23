/** 条件分支节点定义元数据（§4.2 / §3.5 琥珀）。 */
import type { NodeMeta, NodeHandleSpec } from "../../types.js";
import type { WorkflowNode } from "@dsh-workflow/schema";

export const meta: NodeMeta = {
  type: "if_else",
  label: "条件分支",
  icon: "\u{1F500}",
  colorToken: "#f59e0b",
  group: "logic",
  badgeText: "IF_ELSE",
  handles: [
    { kind: "target" },
    { kind: "source", id: "true", offsetRatio: 0.28, label: "T" },
    { kind: "source", id: "false", offsetRatio: 0.72, label: "F" },
  ] as NodeHandleSpec[],
  defaultFactory(id: string): WorkflowNode {
    return { id, type: "if_else", name: "条件分支", condition: "" } as WorkflowNode;
  },
  checkValid(node: WorkflowNode): string | null {
    const condition = (node as { condition?: unknown }).condition;
    return typeof condition === "string" && condition.trim().length > 0
      ? null
      : "条件表达式不能为空";
  },
  subtitle(node: WorkflowNode): string {
    const raw = String((node as { condition?: unknown }).condition ?? "").replace(/[\r\n]+/g, " ").trim();
    return "expr: " + (raw.length > 28 ? raw.slice(0, 27) + "\u2026" : raw);
  },
};

export default meta;
