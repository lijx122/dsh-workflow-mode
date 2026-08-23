/**
 * DSH Web GUI Client Plugin Entry for Workflow Canvas
 * 
 * 契约规范说明（对齐 IMPLEMENTATION_PLAN.md「Web client 插件契约」）：
 * - package.json 中声明 dsh.client.platform = "web"
 * - 依赖注入模块：@deepseek-ai/dsh-client-ui-slots, @deepseek-ai/dsh-client-runtime
 * - bundle 入口对应 exports["./client"]
 * 
 * 真实宿主挂载待联测：
 * 运行时在真实 DSH 宿主环境经 slots.register(...) 注册工作区视图 Slot (viewId=workflow-canvas)
 * 与会话/运行视图路由切换；随 web-ui-all 聚合包安装生效。
 */

import { WorkflowCanvas } from "./canvas.js";

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
 * Client 插件激活/注册入口
 */
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

export default {
  activate,
  WorkflowCanvas,
};
