/** 合并 节点定义元数据（§4.2 映射表 / §3.5 扩展调色板声明见 node-styles.module.css）。 */
import type { NodeMeta } from "../../types.js";
import type { WorkflowNode } from "@dsh-workflow/schema";

export const meta: NodeMeta = {
  type: "merge",
  label: "合并",
  icon: "🔗",
  colorToken: "#059669",
  group: "logic",
  badgeText: "MERGE",
  defaultFactory(id: string): WorkflowNode {
    return { id, type: "merge", name: "合并", strategy: "shallow" } as WorkflowNode;
  },
  checkValid(node: WorkflowNode): string | null {
    return (() => { const s = (node as { strategy?: unknown }).strategy; return s === undefined || s === "shallow" || s === "deep" ? null : "strategy 仅支持 shallow/deep"; })();
  },
  subtitle(node: WorkflowNode): string {
    return "strategy: " + ((node as { strategy?: string }).strategy ?? "shallow");
  },
};

export default meta;
