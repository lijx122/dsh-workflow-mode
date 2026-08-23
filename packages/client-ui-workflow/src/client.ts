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

/**
 * Cordis Client apply entrypoint.
 * No injected services needed — WorkflowCanvas is exported as a standalone React view.
 */
export function apply(): void {}

/**
 * Activation hook for test suites / custom callers
 */
export function activate(ctx?: { slots?: { register?: (def: any) => void } }): void {
  if (ctx && typeof ctx === "object" && "slots" in ctx && ctx.slots?.register) {
    ctx.slots.register({
      id: "workflow-canvas",
      title: "Workflow Canvas",
      icon: "git-merge",
      component: WorkflowCanvas,
    });
  }
}

export { WorkflowCanvas };

export default {
  apply,
  activate,
  WorkflowCanvas,
};
