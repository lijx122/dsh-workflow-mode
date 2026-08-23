/** 结束 节点定义元数据（§4.2 映射表 / §3.5 扩展调色板声明见 node-styles.module.css）。 */
import type { NodeMeta, NodeHandleSpec } from "../../types.js";
import type { WorkflowNode } from "@dsh-workflow/schema";

export const meta: NodeMeta = {
  type: "end",
  label: "结束",
  icon: "🛑",
  colorToken: "#61666b",
  group: "logic",
  badgeText: "END",
  defaultFactory(id: string): WorkflowNode {
    return { id, type: "end", name: "结束", outputs: {} } as WorkflowNode;
  },
  checkValid(node: WorkflowNode): string | null {
    return null;
  },
  subtitle(node: WorkflowNode): string {
    return (() => { const outs = (node as { outputs?: Record<string, unknown> }).outputs ?? {}; const first = Object.keys(outs)[0]; return first !== undefined ? "output: " + first : "无输出映射"; })();
  },
};

export default meta;
