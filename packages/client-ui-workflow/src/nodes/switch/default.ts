/** 多路分支 节点定义元数据（§4.2 映射表 / §3.5 扩展调色板声明见 node-styles.module.css）。 */
import type { NodeMeta, NodeHandleSpec } from "../../types.js";
import type { WorkflowNode } from "@dsh-workflow/schema";

export const meta: NodeMeta = {
  type: "switch",
  label: "多路分支",
  icon: "🎛️",
  colorToken: "#f59e0b",
  group: "logic",
  badgeText: "SWITCH",
  defaultFactory(id: string): WorkflowNode {
    return { id, type: "switch", name: "多路分支", cases: [{ when: "", target: "" }] } as WorkflowNode;
  },
  checkValid(node: WorkflowNode): string | null {
    return (() => { const c = (node as { cases?: unknown }).cases; return Array.isArray(c) && c.length > 0 ? null : "至少需要一个 case 分支"; })();
  },
  subtitle(node: WorkflowNode): string {
    return (() => { const c = (node as { cases?: unknown }).cases; return (Array.isArray(c) ? c.length : 0) + " cases"; })();
  },
};

export default meta;
