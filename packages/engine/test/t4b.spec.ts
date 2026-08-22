import { describe, it, expect } from "vitest";

import { WorkflowEngine as Engine } from "../src/index.js";
import type {
  NodeExecutor as Executor,
  NodeType as NType,
} from "../src/index.js";
import type { WorkflowDSL as DSL } from "@dsh-workflow/schema";

/**
 * 内联 stub 执行器工厂：填满全部 21 种 NodeType 的默认执行器，
 * 测试中仅覆写需要的类型。不涉及真实 dsh-llm 等服务。
 */
function stubExecutors(
  overrides: Partial<Record<NType, Executor>> = {},
): Record<NType, Executor> {
  const defaults: Record<NType, Executor> = {
    start: { type: "start", execute: async () => ({}) },
    end: { type: "end", execute: async () => ({}) },
    if_else: { type: "if_else", execute: async () => ({}) },
    iteration: { type: "iteration", execute: async () => ({}) },
    human: { type: "human", execute: async () => ({}) },
    llm: { type: "llm", execute: async () => ({}) },
    subagent: { type: "subagent", execute: async () => ({}) },
    code: { type: "code", execute: async () => ({ result: "ok" }) },
    template: { type: "template", execute: async () => ({}) },
    set_variable: { type: "set_variable", execute: async () => ({}) },
    plugin_tool: { type: "plugin_tool", execute: async () => ({}) },
    switch: { type: "switch", execute: async () => ({}) },
    wait: { type: "wait", execute: async () => ({}) },
    merge: { type: "merge", execute: async () => ({}) },
    error_fallback: { type: "error_fallback", execute: async () => ({}) },
    schedule_trigger: { type: "schedule_trigger", execute: async () => ({}) },
    webhook_trigger: { type: "webhook_trigger", execute: async () => ({}) },
    intent_classifier: { type: "intent_classifier", execute: async () => ({}) },
    parameter_extractor: { type: "parameter_extractor", execute: async () => ({}) },
    sub_workflow: { type: "sub_workflow", execute: async () => ({}) },
    http_request: { type: "http_request", execute: async () => ({}) },
  };
  return { ...defaults, ...overrides };
}

function dsl(
  nodes: Array<Record<string, unknown>>,
  edges: Array<Record<string, unknown>>,
): DSL {
  return {
    version: "dsh.workflow.v1",
    name: "test",
    nodes: nodes as unknown as DSL["nodes"],
    edges: edges as unknown as DSL["edges"],
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 等待 ctx.signal 中止（模拟执行器感知熔断/stop），带兜底超时防悬挂 */
function waitForAbort(ctx: { signal: AbortSignal }, fallbackMs = 2000): Promise<void> {
  return new Promise((resolve) => {
    if (ctx.signal.aborted) {
      resolve();
      return;
    }
    const t = setTimeout(() => resolve(), fallbackMs);
    ctx.signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

describe("WorkflowEngine · T4b（熔断/重试/DPE/快照/AbortSignal）", () => {
  it("① 超时熔断：stub 执行器睡眠超过节点 timeoutMs → 节点 failed 且错误含 timeout", async () => {
    const workflow = dsl(
      [
        { id: "start", type: "start" },
        { id: "slow", type: "code", code: "slow", timeoutMs: 50 },
        { id: "end", type: "end" },
      ],
      [
        { id: "e1", source: "start", target: "slow" },
        { id: "e2", source: "slow", target: "end" },
      ],
    );

    const engine = new Engine(
      stubExecutors({
        start: { type: "start", execute: async () => ({ ok: true }) },
        code: {
          type: "code",
          execute: async (_n, _i, ctx) => {
            // 睡眠远超超时；熔断信号到达后立即返回（清理模拟），避免悬挂计时器
            await waitForAbort(ctx);
            return { late: true };
          },
        },
        end: { type: "end", execute: async () => ({ done: true }) },
      }),
    );

    const result = await engine.run(workflow, {});
    expect(result.status).toBe("failed");
    expect(result.nodeStates.start.status).toBe("success");
    expect(result.nodeStates.slow.status).toBe("failed");
    expect(result.nodeStates.slow.error).toContain("timeout");
    expect(result.nodeStates.end.status).toBe("pending");
    expect(
      result.events.some(
        (ev) => ev.type === "node_error" && ev.nodeId === "slow",
      ),
    ).toBe(true);
  });

  it("①b 引擎默认 defaultNodeTimeoutMs 生效（构造可配，节点未设 timeoutMs）", async () => {
    const workflow = dsl(
      [
        { id: "start", type: "start" },
        { id: "drowsy", type: "code", code: "drowsy" },
        { id: "end", type: "end" },
      ],
      [
        { id: "e1", source: "start", target: "drowsy" },
        { id: "e2", source: "drowsy", target: "end" },
      ],
    );

    const engine = new Engine(
      stubExecutors({
        start: { type: "start", execute: async () => ({ ok: true }) },
        code: {
          type: "code",
          execute: async (_n, _i, ctx) => {
            await waitForAbort(ctx);
            return { late: true };
          },
        },
        end: { type: "end", execute: async () => ({ done: true }) },
      }),
      { defaultNodeTimeoutMs: 40 },
    );

    const result = await engine.run(workflow, {});
    expect(result.status).toBe("failed");
    expect(result.nodeStates.drowsy.status).toBe("failed");
    expect(result.nodeStates.drowsy.error).toContain("timeout");
  });

  it("② 重试：前 2 次抛错第 3 次成功（retry:{max:2,backoffMs:10}）→ success，node_error 含 attempt 1/2", async () => {
    const workflow = dsl(
      [
        { id: "start", type: "start" },
        { id: "flaky", type: "code", code: "retry me", retry: { max: 2, backoffMs: 10 } },
        { id: "end", type: "end" },
      ],
      [
        { id: "e1", source: "start", target: "flaky" },
        { id: "e2", source: "flaky", target: "end" },
      ],
    );

    let calls = 0;
    const engine = new Engine(
      stubExecutors({
        start: { type: "start", execute: async () => ({ ok: true }) },
        code: {
          type: "code",
          execute: async () => {
            calls++;
            if (calls < 3) throw new Error(`fail #${calls}`);
            return { ok: true };
          },
        },
        end: { type: "end", execute: async () => ({ done: true }) },
      }),
    );

    const result = await engine.run(workflow, {});
    expect(result.status).toBe("success");
    expect(result.nodeStates.flaky.status).toBe("success");
    expect(calls).toBe(3);

    const errs = result.events.filter(
      (ev) => ev.type === "node_error" && ev.nodeId === "flaky",
    );
    expect(errs.map((ev) => ev.data?.attempt)).toEqual([1, 2]);
    expect(result.nodeStates.end.status).toBe("success");

    // 对比：无 retry 配置的节点失败不重跑（回归断言）
    const plain = await new Engine(
      stubExecutors({
        start: { type: "start", execute: async () => ({}) },
        code: {
          type: "code",
          execute: async () => {
            throw new Error("boom");
          },
        },
        end: { type: "end", execute: async () => ({}) },
      }),
    ).run(
      dsl(
        [
          { id: "start", type: "start" },
          { id: "bad", type: "code", code: "x" },
          { id: "end", type: "end" },
        ],
        [
          { id: "e1", source: "start", target: "bad" },
          { id: "e2", source: "bad", target: "end" },
        ],
      ),
      {},
    );
    expect(plain.status).toBe("failed");
    expect(plain.nodeStates.bad.status).toBe("failed");
  });

  it("③ DPE fork-join：if_else 双分支汇聚 deploy，true/false 两向整图跑通无死锁，未命中支线节点 skipped", async () => {
    const workflow = dsl(
      [
        { id: "start", type: "start" },
        { id: "gate", type: "if_else", condition: "1 == 1" },
        { id: "human_approve", type: "human", prompt: "确认继续？" },
        { id: "false_prep", type: "code", code: "noop" },
        { id: "deploy", type: "code", code: "deploy" },
        { id: "end", type: "end" },
      ],
      [
        { id: "e1", source: "start", target: "gate" },
        { id: "e2", source: "gate", target: "human_approve", branch: "true" },
        { id: "e3", source: "gate", target: "false_prep", branch: "false" },
        { id: "e4", source: "human_approve", target: "deploy" },
        { id: "e5", source: "false_prep", target: "deploy" },
        { id: "e6", source: "deploy", target: "end" },
      ],
    );

    // if_else 执行器输出 { branch }：引擎据此激活命中出边、向未命中分支传播 SKIPPED
    const makeEngine = (branch: "true" | "false", executed: string[]) =>
      new Engine(
        stubExecutors({
          start: { type: "start", execute: async (_n, i) => ({ ...i }) },
          if_else: { type: "if_else", execute: async () => ({ branch }) },
          human: {
            type: "human",
            execute: async (_n, _i, ctx) => {
              executed.push(ctx.nodeId);
              return { approved: true };
            },
          },
          code: {
            type: "code",
            execute: async (_n, _i, ctx) => {
              executed.push(ctx.nodeId);
              return { done: true };
            },
          },
          end: {
            type: "end",
            execute: async (_n, _i, ctx) => {
              executed.push(ctx.nodeId);
              return { finished: true };
            },
          },
        }),
        { maxParallelNodes: 4 },
      );

    // ---- true 方向：human_approve 执行，false_prep 被跳过 ----
    const executedTrue: string[] = [];
    const resTrue = await makeEngine("true", executedTrue).run(workflow, {});
    expect(resTrue.status).toBe("success");
    expect(resTrue.nodeStates.gate.status).toBe("success");
    expect(resTrue.nodeStates.human_approve.status).toBe("success");
    expect(resTrue.nodeStates.false_prep.status).toBe("skipped");
    expect(resTrue.nodeStates.deploy.status).toBe("success");
    expect(resTrue.nodeStates.end.status).toBe("success");
    // skipped 节点不执行 executor、不发 node_start，但有 node_skip 事件
    expect(executedTrue).not.toContain("false_prep");
    expect(
      resTrue.events.some(
        (ev) => ev.type === "node_skip" && ev.nodeId === "false_prep",
      ),
    ).toBe(true);
    expect(
      resTrue.events.some(
        (ev) => ev.type === "node_start" && ev.nodeId === "false_prep",
      ),
    ).toBe(false);
    // 无死锁：end 完成
    expect(
      resTrue.events.some(
        (ev) => ev.type === "node_finish" && ev.nodeId === "end",
      ),
    ).toBe(true);

    // ---- false 方向：false_prep 执行，human_approve 被跳过（OR-Join 仍触发 deploy）----
    const executedFalse: string[] = [];
    const resFalse = await makeEngine("false", executedFalse).run(workflow, {});
    expect(resFalse.status).toBe("success");
    expect(resFalse.nodeStates.false_prep.status).toBe("success");
    expect(resFalse.nodeStates.human_approve.status).toBe("skipped");
    expect(resFalse.nodeStates.deploy.status).toBe("success");
    expect(resFalse.nodeStates.end.status).toBe("success");
    expect(executedFalse).not.toContain("human_approve");
    expect(
      resFalse.events.some(
        (ev) => ev.type === "node_skip" && ev.nodeId === "human_approve",
      ),
    ).toBe(true);
    expect(
      resFalse.events.some(
        (ev) => ev.type === "node_start" && ev.nodeId === "human_approve",
      ),
    ).toBe(false);
  });

  it("④ 快照隔离：run 进行中修改传入的 dsl（push 新节点+边），当前 run 结果不受影响", async () => {
    const workflow = dsl(
      [
        { id: "start", type: "start" },
        { id: "hold", type: "code", code: "hold" },
        { id: "end", type: "end" },
      ],
      [
        { id: "e1", source: "start", target: "hold" },
        { id: "e2", source: "hold", target: "end" },
      ],
    );

    let enterHold!: () => void;
    const holdEntered = new Promise<void>((r) => (enterHold = r));
    let releaseHold!: () => void;
    const holdGate = new Promise<void>((r) => (releaseHold = r));

    const engine = new Engine(
      stubExecutors({
        start: { type: "start", execute: async () => ({ ok: true }) },
        code: {
          type: "code",
          execute: async (_n, _i, ctx) => {
            if (ctx.nodeId === "hold") {
              enterHold();
              await holdGate;
              return { held: true };
            }
            return { ok: true };
          },
        },
        end: { type: "end", execute: async () => ({ done: true }) },
      }),
    );

    const runPromise = engine.run(workflow, { x: 1 });
    await holdEntered; // hold 已进入运行

    // 运行中外部修改传入的 dsl —— 不应影响进行中 run
    workflow.nodes.push({ id: "intruder", type: "code", code: "x" } as never);
    workflow.edges.push({ id: "e9", source: "hold", target: "intruder" } as never);

    releaseHold();
    const result = await runPromise;

    expect(result.status).toBe("success");
    expect(Object.keys(result.nodeStates).sort()).toEqual(["end", "hold", "start"]);
    expect(result.nodeStates.hold.status).toBe("success");
    expect(result.nodeStates.end.status).toBe("success");
    expect(result.nodeStates.intruder).toBeUndefined();
    expect(
      result.events.some(
        (ev) => ev.type === "node_start" && ev.nodeId === "intruder",
      ),
    ).toBe(false);
    expect(Object.keys(result.outputs).sort()).toEqual(["end", "hold", "start"]);
  });

  it("⑤ stop→abort：stop 中止 run 级 AbortController，进行中 executor 经 ctx.signal 感知 aborted=true", async () => {
    const workflow = dsl(
      [
        { id: "start", type: "start" },
        { id: "long", type: "code", code: "long" },
        { id: "end", type: "end" },
      ],
      [
        { id: "e1", source: "start", target: "long" },
        { id: "e2", source: "long", target: "end" },
      ],
    );

    let announceRunId!: (id: string) => void;
    const runIdPromise = new Promise<string>((r) => (announceRunId = r));
    const seenAborted: boolean[] = [];

    const engine = new Engine(
      stubExecutors({
        start: { type: "start", execute: async () => ({ ok: true }) },
        code: {
          type: "code",
          execute: async (_n, _i, ctx) => {
            // 长执行节点：对外暴露 runId（供外部 stop），并等待信号
            announceRunId(ctx.runId);
            await waitForAbort(ctx);
            seenAborted.push(ctx.signal.aborted);
            return { seenAborted: ctx.signal.aborted };
          },
        },
        end: { type: "end", execute: async () => ({ done: true }) },
      }),
    );

    const runPromise = engine.run(workflow, {});

    // 等待 long 节点进入运行并拿到 runId，随后外部 stop
    const id = await runIdPromise;
    const stopped = engine.stop(id);
    expect(stopped).toBe(true);

    const result = await runPromise;
    expect(result.status).toBe("stopped");
    // 进行中的 long 节点感知到 signal.aborted=true
    expect(seenAborted).toEqual([true]);
    expect(result.nodeStates.long.status).toBe("success");
    // stop 后不再派发新任务：end 保持 pending（无 node_start）
    expect(result.nodeStates.end.status).toBe("pending");
    expect(
      result.events.some(
        (ev) => ev.type === "node_start" && ev.nodeId === "end",
      ),
    ).toBe(false);
  });
});
