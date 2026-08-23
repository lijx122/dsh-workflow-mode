/**
 * DSH Web GUI Client Plugin Entry for Workflow Canvas
 * 
 * 契约规范说明（对齐 IMPLEMENTATION_PLAN.md「Web client 插件契约」）：
 * - package.json 中声明 dsh.client.platform = "web"
 * - 依赖注入模块：@deepseek-ai/dsh-client-ui-slots, @deepseek-ai/dsh-client-runtime
 * - bundle 入口对应 exports["./client"]
 * - 遵循 DSH ModuleLoader 惰性 CJS factory 规约 (apply / inject)
 */

import { WorkflowCanvas } from "./canvas.js";

export const inject = ["slots", "runtime"];

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

/**
 * Client 插件激活/注册入口 (Cordis Client apply contract)
 */
export function apply(ctx?: DshClientContext): void {
  if (ctx?.slots?.register) {
    ctx.slots.register({
      id: "workflow-canvas",
      title: "Workflow Canvas",
      icon: "git-merge",
      component: WorkflowCanvas,
    });
  }
}

export function activate(ctx?: DshClientContext): void {
  apply(ctx);
}

export { WorkflowCanvas };

export default {
  apply,
  activate,
  WorkflowCanvas,
};
