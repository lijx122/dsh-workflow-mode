/** 子 Agent 节点定义元数据（§4.2 映射表 / §3.5 扩展调色板声明见 node-styles.module.css）。 */
import type { NodeMeta } from "../../types.js";
import type { WorkflowNode } from "@dsh-workflow/schema";

export const meta: NodeMeta = {
  type: "subagent",
  label: "子 Agent",
  icon: "🧠",
  colorToken: "#06b6d4",
  group: "ai",
  badgeText: "SUBAGENT",
  defaultFactory(id: string): WorkflowNode {
    return { id, type: "subagent", name: "子 Agent", prompt: "", preset: "standard" } as WorkflowNode;
  },
  checkValid(node: WorkflowNode): string | null {
    return (() => { const p = (node as { prompt?: unknown }).prompt; return typeof p === "string" && p.trim().length > 0 ? null : "任务 prompt 不能为空"; })();
  },
  subtitle(node: WorkflowNode): string {
    return "preset: " + (() => { const n = node as { preset?: unknown }; return typeof n.preset === "string" && n.preset !== "" ? n.preset : "standard"; })();
  },
};

export default meta;
