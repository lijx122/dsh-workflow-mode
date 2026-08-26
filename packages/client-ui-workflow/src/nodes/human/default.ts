/** 人工审批 节点定义元数据（§4.2 映射表 / §3.5 扩展调色板声明见 node-styles.module.css）。 */
import type { NodeMeta } from "../../types.js";
import type { WorkflowNode } from "@dsh-workflow/schema";

export const meta: NodeMeta = {
  type: "human",
  label: "人工审批",
  icon: "👤",
  colorToken: "var(--dsw-tint-text)",
  group: "ai",
  badgeText: "HUMAN",
  defaultFactory(id: string): WorkflowNode {
    return { id, type: "human", name: "人工审批", prompt: "", onTimeout: "proceed" } as WorkflowNode;
  },
  checkValid(node: WorkflowNode): string | null {
    return (() => { const p = (node as { prompt?: unknown }).prompt; return typeof p === "string" && p.trim().length > 0 ? null : "审批提示文案不能为空"; })();
  },
  subtitle(node: WorkflowNode): string {
    return (() => { const raw = String((node as { prompt?: unknown }).prompt ?? "").replace(/[\r\n]+/g, " ").trim(); return raw.length > 30 ? raw.slice(0, 29) + "\u2026" : raw || "(未填写审批提示)"; })();
  },
};

export default meta;
