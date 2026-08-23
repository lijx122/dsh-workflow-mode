/** 循环 节点定义元数据（§4.2 映射表 / §3.5 扩展调色板声明见 node-styles.module.css）。 */
import type { NodeMeta } from "../../types.js";
import type { WorkflowNode } from "@dsh-workflow/schema";

export const meta: NodeMeta = {
  type: "iteration",
  label: "循环",
  icon: "♾️",
  colorToken: "#0891b2",
  group: "logic",
  badgeText: "ITER",
  defaultFactory(id: string): WorkflowNode {
    return { id, type: "iteration", name: "循环", over: "items", maxIterations: 100 } as WorkflowNode;
  },
  checkValid(node: WorkflowNode): string | null {
    return (() => { const over = (node as { over?: unknown }).over; return typeof over === "string" && over.trim().length > 0 ? null : "over 数组引用不能为空"; })();
  },
  subtitle(node: WorkflowNode): string {
    return "over: " + String((node as { over?: unknown }).over ?? "");
  },
};

export default meta;
