import type { NodeExecutor, NodeOutput } from "../engine.js";
import type { ExecutionContext } from "../engine.js";
import type { HumanNode } from "@dsh-workflow/schema";
import { hostNotBound } from "./errors.js";

/**
 * human：人机交互断点节点。
 *
 * 契约：
 * - 调 host.askUser({ prompt: node.prompt 插值后, inputs: 当前 inputs 快照 })
 * - 返回 Promise<{ decision, inputs? }>
 * - decision === "rejected" → 节点以含 "rejected" 描述的错误失败
 * - decision === "approved" 且 response.inputs 非空 → 合并入节点输出（回写），
 *   下游可用 {{#nodeId.field}} 引用用户输入值
 * - node.timeoutMs 设内部超时（onTimeout 默认 "abort"）；
 *   超时后 onTimeout="abort" → 抛错，onTimeout="proceed" → 以 {decision:"proceed"} 继续
 * - ctx.signal abort 时（run stop / 熔断）立即 reject
 * - host.askUser 缺失 → 抛 hostNotBound("askUser")
 */
export const humanExecutor: NodeExecutor = {
  type: "human",
  async execute(
    node: HumanNode,
    inputs: Record<string, NodeOutput[string]>,
    ctx: ExecutionContext,
  ): Promise<NodeOutput> {
    const askUser = ctx.host.askUser;
    if (!askUser) {
      throw hostNotBound("askUser");
    }

    // prompt 插值（支持 {{#prev.field}} 引用上游变量）；inputs 做深拷贝快照，
    // 避免传给外部进程期间被并发修改
    const prompt = ctx.varCtx.interpolate(node.prompt);
    const inputsSnapshot =
      inputs && typeof inputs === "object"
        ? structuredClone(inputs)
        : undefined;

    const timeoutMs = node.timeoutMs ?? 0;
    const onTimeout = node.onTimeout ?? "abort";

    const askPromise = askUser({ prompt, inputs: inputsSnapshot });

    // run stop / 熔断传播：signal abort 即拒绝，human 等待不悬挂
    let onAbort: (() => void) | undefined;
    const signalPromise = new Promise<never>((_, reject) => {
      onAbort = () =>
        reject(
          new Error(`human node "${ctx.nodeId}" aborted by run signal`),
        );
      if (ctx.signal.aborted) {
        onAbort();
        return;
      }
      ctx.signal.addEventListener("abort", onAbort, { once: true });
    });

    // 超时竞争者：one-shot timer，mode=proceed 时 resolve {decision:"proceed"}，abort 时 reject
    // timer 句柄挂外层，race 无论谁赢都在 finally 无脑清理——askUser 悬挂时
    // abort/proceed 赢出 race，若不清理 pending setTimeout 会钉住事件循环直到 timeoutMs
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise =
      timeoutMs > 0
        ? new Promise<{ decision: string }>((resolve, reject) => {
            timer = setTimeout(() => {
              if (onTimeout === "proceed") {
                resolve({ decision: "proceed" });
              } else {
                reject(
                  new Error(
                    `human node "${ctx.nodeId}" timed out after ${timeoutMs}ms (onTimeout=abort)`,
                  ),
                );
              }
            }, timeoutMs);
          })
        : null;

    let outcome: { decision: string; inputs?: Record<string, NodeOutput[string]> };
    try {
      const settled = await Promise.race([
        askPromise,
        ...(timeoutPromise ? [timeoutPromise] : []),
        signalPromise,
      ]);
      outcome = settled as typeof outcome;
    } catch (e: unknown) {
      if (e instanceof Error) throw e;
      throw new Error(String(e));
    } finally {
      // race 尘埃落定即清理：timer 不再需要（防事件循环钉住），abort listener 用完即撤
      if (timer !== undefined) clearTimeout(timer);
      if (onAbort) ctx.signal.removeEventListener("abort", onAbort);
    }

    if (outcome.decision === "rejected") {
      throw new Error(`human node "${ctx.nodeId}" rejected: decision=rejected`);
    }

    // 合并回写：outcome.inputs 非空时合并进节点输出（varCtx 记录即节点输出，
    // 引擎在成功后 varCtx.set(nodeId, output)——见 engine.dispatch 的 "success" 分支）。
    // 先铺用户 inputs、最后写 decision：decision 是协议字段（权威），
    // 用户提交名为 decision 的审批字段不得覆盖协议值
    const mergedOutput: NodeOutput = {};
    if (outcome.inputs && typeof outcome.inputs === "object") {
      for (const [k, v] of Object.entries(outcome.inputs)) {
        mergedOutput[k] = v as NodeOutput[string];
      }
      mergedOutput.inputs = outcome.inputs as Record<string, NodeOutput[string]>;
    }
    mergedOutput.decision = outcome.decision;

    return mergedOutput;
  },
};
