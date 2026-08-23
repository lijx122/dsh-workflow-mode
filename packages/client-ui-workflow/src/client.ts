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

export function apply(_ctx?: unknown): void {
  // Client plugin loaded into DSH Web GUI runtime.
  // WorkflowCanvas component is exported for canvas and session views.
}

export function activate(ctx?: unknown): void {
  apply(ctx);
}

export { WorkflowCanvas };

export default {
  apply,
  activate,
  WorkflowCanvas,
};
