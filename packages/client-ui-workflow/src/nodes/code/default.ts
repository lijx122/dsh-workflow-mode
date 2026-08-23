/** 代码执行 节点定义元数据（§4.2 映射表 / §3.5 扩展调色板声明见 node-styles.module.css）。 */
import type { NodeMeta } from "../../types.js";
import type { WorkflowNode } from "@dsh-workflow/schema";

export const meta: NodeMeta = {
  type: "code",
  label: "代码执行",
  icon: "💻",
  colorToken: "#8b5cf6",
  group: "transform",
  badgeText: "CODE",
  defaultFactory(id: string): WorkflowNode {
    return { id, type: "code", name: "代码执行", code: "// 受限沙箱：仅 console/Math/JSON 与输入变量可用\nreturn input;" } as WorkflowNode;
  },
  checkValid(node: WorkflowNode): string | null {
    return (() => { const c = (node as { code?: unknown }).code; return typeof c === "string" && c.trim().length > 0 ? null : "代码不能为空"; })();
  },
  subtitle(node: WorkflowNode): string {
    return (() => { const lines = String((node as { code?: unknown }).code ?? "").split("\n").length; return "js \u00b7 " + lines + " 行"; })();
  },
};

export default meta;
