import { describe, it, expect } from "vitest";
import type { WorkflowValidationError } from "../src/index.js"; // WorkflowValidationError 由 engine 导出（schema 不导出）

import {
  WorkflowEngine as Engine,
  WorkflowValidationError as ValidationError,
} from "../src/index.js";
import type { NodeExecutor as Executor, NodeType as NType } from "../src/index.js";
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
    if_else: { type: "if_else", execute: async (_n, _i, ctx) => { ctx.log({ timestamp: Date.now(), runId: ctx.runId, type: "node_finish", nodeId: ctx.nodeId }); return {}; } },
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

function dsl(nodes: Array<Record<string, unknown>>, edges: Array<Record<string, unknown>>): DSL {
  return {
    version: "dsh.workflow.v1",
    name: "test",
    nodes: nodes as unknown as DSL["nodes"],
    edges: edges as unknown as DSL["edges"],
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("WorkflowEngine", () => {
  it("① 3 节点线性图按序完成，outputs 正确", async () => {
    const workflow = dsl(
      [
        { id: "start", type: "start" },
        { id: "code", type: "code", code: "return 1" },
        { id: "end", type: "end" },
      ],
      [
        { id: "e1", source: "start", target: "code" },
        { id: "e2", source: "code", target: "end" },
      ],
    );

    const engine = new Engine(
      stubExecutors({
        start: {
          type: "start",
          execute: async (_n, i) => ({ ...i, started: true }),
        },
        code: { type: "code", execute: async () => ({ result: "computed" }) },
        end: { type: "end", execute: async () => ({ done: true }) },
      }),
    );

    const result = await engine.run(workflow, { x: 1 });

    expect(result.status).toBe("success");
    expect(result.nodeStates.start.status).toBe("success");
    expect(result.nodeStates.code.status).toBe("success");
    expect(result.nodeStates.end.status).toBe("success");
    expect(result.outputs.start).toEqual({ x: 1, started: true });
    expect(result.outputs.code.result).toBe("computed");
    expect(result.outputs.end.done).toBe(true);

    // 按序完成：start.finishedAt <= code.startedAt <= code.finishedAt <= end.startedAt
    expect(result.nodeStates.start.finishedAt!).toBeLessThanOrEqual(
      result.nodeStates.code.startedAt!,
    );
    expect(result.nodeStates.code.finishedAt!).toBeLessThanOrEqual(
      result.nodeStates.end.startedAt!,
    );
    expect(result.nodeStates.end.finishedAt!).toBeDefined();

    // 事件序列完整性
    const types = result.events.map((e) => e.type);
    expect(types[0]).toBe("run_start");
    expect(types[types.length - 1]).toBe("run_finish");
  });

  it("② 菱形图（start→a,b→end）并发上限 2 下全部完成且结果正确", async () => {
    const workflow = dsl(
      [
        { id: "start", type: "start" },
        { id: "a", type: "code", code: "branch A" },
        { id: "b", type: "code", code: "branch B" },
        { id: "end", type: "end" },
      ],
      [
        { id: "e1", source: "start", target: "a" },
        { id: "e2", source: "start", target: "b" },
        { id: "e3", source: "a", target: "end" },
        { id: "e4", source: "b", target: "end" },
      ],
    );

    const order: string[] = [];
    let running = 0;
    let maxRunning = 0;

    const engine = new Engine(
      stubExecutors({
        start: { type: "start", execute: async (_n, i) => ({ ...i }) },
        code: {
          type: "code",
          execute: async (_n, _i, ctx) => {
            running++;
            maxRunning = Math.max(maxRunning, running);
            await sleep(ctx.nodeId === "a" ? 20 : 10);
            running--;
            order.push(ctx.nodeId);
            return { branch: ctx.nodeId === "a" ? "A" : "B" };
          },
        },
        end: {
          type: "end",
          execute: async () => {
            order.push("end");
            return { done: true };
          },
        },
      }),
      { maxParallelNodes: 2 },
    );

    const result = await engine.run(workflow, {});

    expect(result.status).toBe("success");
    expect(result.nodeStates.a.status).toBe("success");
    expect(result.nodeStates.b.status).toBe("success");
    expect(result.nodeStates.end.status).toBe("success");
    expect(result.nodeStates.start.status).toBe("success");

    expect(result.outputs.a.branch).toBe("A");
    expect(result.outputs.b.branch).toBe("B");
    expect(result.outputs.end.done).toBe(true);

    // 两分支并发执行过（同时 running 的峰值达到 2）
    expect(maxRunning).toBe(2);
    // end 必须最后完成（依赖 a 与 b 均完成）
    expect(order[order.length - 1]).toBe("end");
    expect(order.slice(0, 2).sort()).toEqual(["a", "b"]);
  });

  it("③ 非法 DSL（含环）run 直接抛 WorkflowValidationError", async () => {
    const workflow = dsl(
      [
        { id: "a", type: "code", code: "a" },
        { id: "b", type: "code", code: "b" },
      ],
      [
        { id: "e1", source: "a", target: "b" },
        { id: "e2", source: "b", target: "a" },
      ],
    );

    const engine = new Engine(stubExecutors());

    try {
      await engine.run(workflow, {});
      throw new Error("应当抛出 WorkflowValidationError");
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      const err = e as WorkflowValidationError;
      expect(err.result.ok).toBe(false);
      expect(err.result.errors.some((er) => er.code === "CYCLE")).toBe(true);
      expect(err.message).toContain("校验失败");
    }
  });

  it("④ 某节点执行器抛错 → 该节点 failed、RunResult.status=failed、下游 pending", async () => {
    const workflow = dsl(
      [
        { id: "start", type: "start" },
        { id: "bad", type: "code", code: "throw" },
        { id: "end", type: "end" },
      ],
      [
        { id: "e1", source: "start", target: "bad" },
        { id: "e2", source: "bad", target: "end" },
      ],
    );

    const engine = new Engine(
      stubExecutors({
        start: { type: "start", execute: async () => ({ ok: true }) },
        code: {
          type: "code",
          execute: async () => {
            throw new Error("oops");
          },
        },
        end: { type: "end", execute: async () => ({ done: true }) },
      }),
    );

    const result = await engine.run(workflow, {});

    expect(result.status).toBe("failed");
    expect(result.nodeStates.start.status).toBe("success");
    expect(result.nodeStates.bad.status).toBe("failed");
    expect(result.nodeStates.bad.error).toContain("oops");
    expect(result.nodeStates.bad.finishedAt).toBeDefined();
    expect(result.nodeStates.end.status).toBe("pending");
    expect(result.nodeStates.end.startedAt).toBeUndefined();

    // 失败产生 node_error 事件
    expect(
      result.events.some((ev) => ev.type === "node_error" && ev.nodeId === "bad"),
    ).toBe(true);
  });

  it("⑤ stop 后不再有新节点进入 running", async () => {
    const workflow = dsl(
      [
        { id: "start", type: "start" },
        { id: "gate", type: "code", code: "gate" },
        { id: "after", type: "code", code: "after" },
        { id: "end", type: "end" },
      ],
      [
        { id: "e1", source: "start", target: "gate" },
        { id: "e2", source: "gate", target: "after" },
        { id: "e3", source: "after", target: "end" },
      ],
    );

    let engine!: Engine;
    engine = new Engine(
      stubExecutors({
        start: {
          type: "start",
          execute: async (_n, i, ctx) => {
            engine.stop(ctx.runId);
            return { ...i };
          },
        },
      }),
    );

    const result = await engine.run(workflow, {});

    expect(result.status).toBe("stopped");
    // start 本身已在 running，停止后完成自己（状态 success）
    expect(result.nodeStates.start.status).toBe("success");
    expect(result.nodeStates.start.finishedAt).toBeDefined();
    // 停止后不再派发新任务：gate/after/end 保持 pending
    expect(result.nodeStates.gate.status).toBe("pending");
    expect(result.nodeStates.after.status).toBe("pending");
    expect(result.nodeStates.end.status).toBe("pending");
    // 已运行节点的 node_finish 事件存在，但无后续 node_start
    expect(
      result.events.filter((ev) => ev.type === "node_start").map((ev) => ev.nodeId),
    ).toEqual(["start"]);

    // 重复 stop 同一 runId 返回 false（run 已结束并清理）
    expect(engine.stop(result.runId)).toBe(false);
  });

  it("⑥ 宽扇出图（1 start 派发 5 子节点，maxParallelNodes=2）启动后立即 stop：积压队列任务不再进入 running", async () => {
    const workflow = dsl(
      [
        { id: "start", type: "start" },
        { id: "a", type: "code", code: "a" },
        { id: "b", type: "code", code: "b" },
        { id: "c", type: "code", code: "c" },
        { id: "d", type: "code", code: "d" },
        { id: "e", type: "code", code: "e" },
        { id: "end", type: "end" },
      ],
      [
        { id: "e1", source: "start", target: "a" },
        { id: "e2", source: "start", target: "b" },
        { id: "e3", source: "start", target: "c" },
        { id: "e4", source: "start", target: "d" },
        { id: "e5", source: "start", target: "e" },
        { id: "e6", source: "a", target: "end" },
        { id: "e7", source: "b", target: "end" },
        { id: "e8", source: "c", target: "end" },
        { id: "e9", source: "d", target: "end" },
        { id: "e10", source: "e", target: "end" },
      ],
    );

    let stopResult: boolean | null = null;
    let engine!: Engine;

    engine = new Engine(
      stubExecutors({
        start: { type: "start", execute: async (_n, i) => ({ ...i }) },
        code: {
          type: "code",
          execute: async (_n, _i, ctx) => {
            // 首个运行中的子节点立即 stop（此时其余子节点已积压在 p-queue 队列中）
            if (stopResult === null) {
              stopResult = engine.stop(ctx.runId);
            }
            return { ok: true };
          },
        },
        end: { type: "end", execute: async () => ({ done: true }) },
      }),
      { maxParallelNodes: 2 },
    );

    const result = await engine.run(workflow, {});

    // stop 已被调用且返回 true
    expect(stopResult).toBe(true);
    expect(result.status).toBe("stopped");

    // start 本身已在 running，停止后完成自己
    expect(result.nodeStates.start.status).toBe("success");
    expect(result.nodeStates.start.finishedAt).toBeDefined();

    // 首个运行中的子节点 a（dispatch 顺序最先进入 running）完成自己
    expect(result.nodeStates.a.status).toBe("success");
    expect(result.nodeStates.a.finishedAt).toBeDefined();

    // stop 后其余 4 个子节点（b/c/d/e）不得再进入 running：保持 pending、无 startedAt
    for (const id of ["b", "c", "d", "e"]) {
      expect(result.nodeStates[id].status).toBe("pending");
      expect(result.nodeStates[id].startedAt).toBeUndefined();
    }

    // end 未被释放，保持 pending
    expect(result.nodeStates.end.status).toBe("pending");
    expect(result.nodeStates.end.startedAt).toBeUndefined();

    // 事件：仅有 start 与 a 产生 node_start，b/c/d/e/end 均无
    const startEventIds = result.events
      .filter((ev) => ev.type === "node_start")
      .map((ev) => ev.nodeId);
    expect(startEventIds).toEqual(["start", "a"]);
  });
});
