/** 开始 节点定义元数据（§4.2 映射表 / §3.5 扩展调色板声明见 node-styles.module.css）。 */
import type { NodeMeta, NodeHandleSpec } from "../../types.js";
import type { WorkflowNode } from "@dsh-workflow/schema";

export const meta: NodeMeta = {
  type: "start",
  label: "开始",
  icon: "🏁",
  colorToken: "#61666b",
  group: "logic",
  badgeText: "START",
  defaultFactory(id: string): WorkflowNode {
    return { id, type: "start", name: "开始", inputs: {} } as WorkflowNode;
  },
  checkValid(node: WorkflowNode): string | null {
    return null;
  },
  subtitle(node: WorkflowNode): string {
    return (() => { const keys = Object.keys((node as { inputs?: Record<string, unknown> }).inputs ?? {}); return keys.length > 0 ? "in: " + keys.join(", ") : "无输入参数"; })();
  },
};

export default meta;
