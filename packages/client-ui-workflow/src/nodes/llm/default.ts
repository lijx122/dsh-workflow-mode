/** LLM 推理 节点定义元数据（§4.2 映射表 / §3.5 扩展调色板声明见 node-styles.module.css）。 */
import type { NodeMeta } from "../../types.js";
import type { WorkflowNode } from "@dsh-workflow/schema";

export const meta: NodeMeta = {
  type: "llm",
  label: "LLM 推理",
  icon: "🤖",
  colorToken: "var(--dsw-alias-state-business-primary)",
  group: "ai",
  badgeText: "LLM",
  defaultFactory(id: string): WorkflowNode {
    return { id, type: "llm", name: "LLM 推理", prompt: "", systemPrompt: "" } as WorkflowNode;
  },
  checkValid(node: WorkflowNode): string | null {
    return (() => { const p = (node as { prompt?: unknown }).prompt; return typeof p === "string" && p.trim().length > 0 ? null : "user 提示词不能为空"; })();
  },
  subtitle(node: WorkflowNode): string {
    return "model: " + (typeof (node as { model?: unknown }).model === "string" && (node as { model?: string }).model !== "" ? (node as { model?: string }).model : "(跟随会话)");
  },
};

export default meta;
