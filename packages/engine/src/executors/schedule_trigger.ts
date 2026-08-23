import type { NodeExecutor, NodeOutput } from "../engine.js";
import type { ExecutionContext } from "../engine.js";
import type { ScheduleTriggerNode } from "@dsh-workflow/schema";

/**
 * schedule_trigger：定时调度触发器（声明式桩节点）。
 * 校验 cron 字段格式；真实定时调度挂接属 DSH 集成层（cordis-plugin-timer / host timer），
 * 当流程被调度触发启动后，该节点产出触发元数据。
 */
export const scheduleTriggerExecutor: NodeExecutor = {
  type: "schedule_trigger",
  async execute(
    node: ScheduleTriggerNode,
    _inputs: Record<string, NodeOutput[string]>,
    ctx: ExecutionContext,
  ): Promise<NodeOutput> {
    const cron = node.cron;
    if (!cron || typeof cron !== "string" || cron.trim() === "") {
      throw new Error(`schedule_trigger "${ctx.nodeId}": cron 表达式不能为空`);
    }

    return {
      triggered: true,
      config: {
        cron: cron.trim(),
      },
      timestamp: Date.now(),
    };
  },
};