/** 文本模板 节点定义元数据（§4.2 映射表 / §3.5 扩展调色板声明见 node-styles.module.css）。 */
import type { NodeMeta } from "../../types.js";
import type { WorkflowNode } from "@dsh-workflow/schema";

export const meta: NodeMeta = {
  type: "template",
  label: "文本模板",
  icon: "📝",
  colorToken: "#ec4899",
  group: "transform",
  badgeText: "TEMPLATE",
  defaultFactory(id: string): WorkflowNode {
    return { id, type: "template", name: "文本模板", template: "" } as WorkflowNode;
  },
  checkValid(node: WorkflowNode): string | null {
    return (() => { const t = (node as { template?: unknown }).template; return typeof t === "string" && t.trim().length > 0 ? null : "模板文本不能为空"; })();
  },
  subtitle(node: WorkflowNode): string {
    return (() => { const raw = String((node as { template?: unknown }).template ?? "").replace(/[\r\n]+/g, " ").trim(); return "tpl: " + (raw.length > 24 ? raw.slice(0, 23) + "\u2026" : raw || "(空)"); })();
  },
};

export default meta;
