import type { NodeExecutor, NodeOutput } from "../engine.js";
import type { ExecutionContext } from "../engine.js";
import type { WebhookTriggerNode } from "@dsh-workflow/schema";

/**
 * webhook_trigger：Webhook 触发器（声明式桩节点）。
 * 校验 name / path 字段非空；真实 Webhook 路由挂接属 DSH Host WebServer（/api/workflows/webhook/:name），
 * 当外部请求打入并经 HMAC/时钟漂移校验派发后，该节点输出触发数据与上下文。
 */
export const webhookTriggerExecutor: NodeExecutor = {
  type: "webhook_trigger",
  async execute(
    node: WebhookTriggerNode,
    inputs: Record<string, NodeOutput[string]>,
    ctx: ExecutionContext,
  ): Promise<NodeOutput> {
    const name = node.name ?? node.path;
    if (!name || typeof name !== "string" || name.trim() === "") {
      throw new Error(`webhook_trigger "${ctx.nodeId}": name 或 path 不能为空`);
    }

    return {
      triggered: true,
      config: {
        name: name.trim(),
        path: node.path ?? null,
        secret: node.secret ? "***" : null,
      },
      body: inputs.body ?? null,
      headers: (inputs.headers as Record<string, string>) ?? {},
      timestamp: Date.now(),
    };
  },
};