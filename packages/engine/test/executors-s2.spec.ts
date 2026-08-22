import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExecutionContext, NodeOutput, NodeExecutor } from "../src/index.js";
import type { NodeType as NType } from "../src/index.js";
import { VariableContext } from "../src/index.js";

// ================= S2 mock Worker =================
// 模拟 Worker 线程退出但不 postMessage 的场景，验证 code.ts 的 promise
// 不再挂起（S2 fix）。
// 注：此 mock 替换整个 node:worker_threads 模块，因此独占此文件。

const __testState = { exitWithoutMessage: false };

vi.mock("node:worker_threads", () => {
  return {
    Worker: class MockWorker {
      private handlers: Record<string, (...args: any[]) => void> = {};

      constructor(_path: string, _options: { workerData: any }) {
        // 异步触发，确保 on() 注册先完成
        process.nextTick(() => {
          if (__testState.exitWithoutMessage) {
            // S2 场景：Worker 以 0 退出，不 postMessage
            this.emit("exit", 0);
          } else {
            // 正常路径：模拟一个成功结果
            this.emit("message", {
              type: "result",
              value: { ok: true },
            });
            this.emit("exit", 0);
          }
        });
      }

      private emit(event: string, ...args: any[]) {
        const h = this.handlers[event];
        if (h) h(...args);
      }

      on(event: string, handler: (...args: any[]) => void) {
        this.handlers[event] = handler;
      }

      terminate() {
        return Promise.resolve(0);
      }
    },
    // 以下仅在 code-worker.ts 中引用，但这里不执行 worker 代码，设为 null 安全
    parentPort: null,
    workerData: null,
  };
});

// ================= helpers =================

function stubExecutors(
  overrides: Partial<Record<NType, NodeExecutor>> = {},
): Record<NType, NodeExecutor> {
  const defaults: Record<NType, NodeExecutor> = {
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

// ================= S2 tests =================

describe("S2: worker exit without message", () => {
  beforeEach(() => {
    __testState.exitWithoutMessage = false;
  });

  it("normal worker exit with message resolves successfully", async () => {
    // 引入真实 code executor（此时 node:worker_threads 已被 mock）
    const { codeExecutor } = await import("../src/executors/code.js");
    const ctx = {
      signal: new AbortController().signal,
      nodeId: "test",
      runId: "test",
      log: vi.fn(),
      varCtx: new VariableContext(),
      host: {} as any,
    };

    const result = await codeExecutor.execute(
      { id: "test", type: "code", code: "return 42" } as any,
      {},
      ctx as any,
    );
    expect(result).toEqual({ ok: true });
  });

  it("worker exits with code 0 without message → rejects with descriptive error", async () => {
    __testState.exitWithoutMessage = true;

    const { codeExecutor } = await import("../src/executors/code.js");
    const ctx = {
      signal: new AbortController().signal,
      nodeId: "test",
      runId: "test",
      log: vi.fn(),
      varCtx: new VariableContext(),
      host: {} as any,
    };

    await expect(
      codeExecutor.execute(
        { id: "test", type: "code", code: "return 42" } as any,
        {},
        ctx as any,
      ),
    ).rejects.toThrow("worker exited without result");
  });

  it("rejects quickly (does not hang) when worker exits without message", async () => {
    __testState.exitWithoutMessage = true;

    const { codeExecutor } = await import("../src/executors/code.js");
    const ctx = {
      signal: new AbortController().signal,
      nodeId: "test",
      runId: "test",
      log: vi.fn(),
      varCtx: new VariableContext(),
      host: {} as any,
    };

    // 配 timeoutMs 兜底：若 promise 挂起，vitest 5000ms 后超时
    // 正常情况应在 100ms 内 reject
    const start = Date.now();
    await expect(
      codeExecutor.execute(
        { id: "test", type: "code", code: "return 42" } as any,
        {},
        ctx as any,
      ),
    ).rejects.toThrow("worker exited without result");
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2000); // 应在数十毫秒内 reject
  }, 10000);
});
