/** 变量赋值 节点定义元数据（§4.2 映射表 / §3.5 扩展调色板声明见 node-styles.module.css）。 */
import type { NodeMeta } from "../../types.js";
import type { WorkflowNode } from "@dsh-workflow/schema";

export const meta: NodeMeta = {
  type: "set_variable",
  label: "变量赋值",
  icon: "🔧",
  colorToken: "#ca8a04",
  group: "logic",
  badgeText: "VAR",
  defaultFactory(id: string): WorkflowNode {
    return { id, type: "set_variable", name: "变量赋值", assignments: [{ key: "result", value: "" }] } as WorkflowNode;
  },
  checkValid(node: WorkflowNode): string | null {
    return (() => { const list = (node as { assignments?: { key?: unknown }[] }).assignments ?? []; return list.some((a) => !a || typeof a.key !== "string" || a.key.length === 0) ? "存在空的变量名" : null; })();
  },
  subtitle(node: WorkflowNode): string {
    return (() => { const first = ((node as { assignments?: { key: string; value: string }[] }).assignments ?? [])[0]; return first ? first.key + " = " + (first.value || "(空)") : "无赋值"; })();
  },
};

export default meta;
