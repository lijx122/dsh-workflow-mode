/**
 * DSH Web GUI Client Plugin Entry for Workflow Canvas
 * 
 * 契约规范说明（对齐 IMPLEMENTATION_PLAN.md「Web client 插件契约」）：
 * - package.json 中声明 dsh.client.platform = "web"
 * - bundle 入口对应 exports["./client"]
 * - 遵循 DSH ModuleLoader 惰性 CJS factory 规约 (apply / inject)
 */

import { WorkflowCanvas } from "./canvas.js";

export const inject = [];

export interface DshClientContext {
  slots?: {
    register: (slotDef: {
      id: string;
      title: string;
      icon?: string;
      component: unknown;
    }) => void;
  };
  runtime?: unknown;
}

export function activate(ctx?: DshClientContext): void {
  if (ctx?.slots?.register) {
    ctx.slots.register({
      id: "workflow-canvas",
      title: "Workflow Canvas",
      icon: "git-merge",
      component: WorkflowCanvas,
    });
  }
}

export function apply(ctx?: DshClientContext): void {
  activate(ctx);
}

export { WorkflowCanvas };

export default {
  apply,
  activate,
  WorkflowCanvas,
};
