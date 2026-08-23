/**
 * DSH Web GUI Client Plugin Entry for Workflow Canvas & Studio
 * 
 * 契约规范说明（对齐 IMPLEMENTATION_PLAN.md「Web client 插件契约」）：
 * - package.json 中声明 dsh.client.platform = "web"
 * - bundle 入口对应 exports["./client"]
 * - 遵循 DSH ModuleLoader 惰性 CJS factory 规约 (apply / inject)
 */

import { WorkflowCanvas } from "./canvas.js";
import { WorkflowStudio } from "./WorkflowStudio.js";
import { mountSidebarEntry } from "./sidebar-entry.js";
import { mountStudio, toggleWorkflowStudio } from "./studio-mount.js";

export const inject = [];

/**
 * Cordis Client apply entrypoint.
 * Automatically mounts the Workflow Studio sidebar navigation item and center-column view.
 */
export function apply(): void {
  try {
    mountSidebarEntry(toggleWorkflowStudio);
    mountStudio();
  } catch (error) {
    console.error("[dsh-workflow] Client UI mounting error:", error);
  }
}

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

export { WorkflowCanvas, WorkflowStudio };

export default {
  apply,
  activate,
  WorkflowCanvas,
  WorkflowStudio,
};
