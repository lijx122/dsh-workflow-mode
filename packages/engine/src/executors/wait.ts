import type { NodeExecutor, NodeOutput } from "../engine.js";
import type { ExecutionContext } from "../engine.js";
import type { WaitNode } from "@dsh-workflow/schema";

/**
 * wait：等待/定时节点。
 * 支持指定毫秒数（waitMs / durationMs）或绝对 ISO 时间戳（until）。
 * 等待过程监听 ctx.signal，支持实时熔断/中止。
 */
export const waitExecutor: NodeExecutor = {
  type: "wait",
  async execute(
    node: WaitNode,
    _inputs: Record<string, NodeOutput[string]>,
    ctx: ExecutionContext,
  ): Promise<NodeOutput> {
    let delayMs = 0;

    if (node.until) {
      const untilStr = ctx.varCtx.interpolate(node.until);
      const targetTime = new Date(untilStr).getTime();
      if (Number.isNaN(targetTime)) {
        throw new Error(`wait 节点 "${ctx.nodeId}": until 时间戳 "${node.until}" 格式非法`);
      }
      delayMs = Math.max(0, targetTime - Date.now());
    } else {
      delayMs = node.waitMs ?? node.durationMs ?? 0;
    }

    if (ctx.signal.aborted) {
      throw new Error(`wait 节点 "${ctx.nodeId}": 运行已中止`);
    }

    if (delayMs > 0) {
      await new Promise<void>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined;

        const onAbort = () => {
          if (timer) clearTimeout(timer);
          reject(new Error(`wait 节点 "${ctx.nodeId}": 中途被信号中止`));
        };

        if (ctx.signal.aborted) {
          onAbort();
          return;
        }

        ctx.signal.addEventListener("abort", onAbort, { once: true });

        timer = setTimeout(() => {
          ctx.signal.removeEventListener("abort", onAbort);
          resolve();
        }, delayMs);
      });
    }

    return {
      waitedMs: delayMs,
      completedAt: Date.now(),
    };
  },
};
