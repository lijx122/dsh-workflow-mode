import { describe, it, expect, vi } from "vitest";

import { WorkflowEngine as Engine } from "../src/index.js";
import { createExecutors } from "../src/index.js";
import type { WorkflowDSL as DSL } from "@dsh-workflow/schema";
import type {
  NodeExecutor as Executor,
  NodeType as NType,
  ExecutionContext,
  NodeOutput,
} from "../src/index.js";
import { VariableContext } from "../src/index.js";

// ================= helpers =================

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

describe("P0 executors (createExecutors)", () => {
  const executors = createExecutors();

  // ========== 1. start ==========
  describe("start", () => {
    it("returns inputs as-is", async () => {
      const executor = executors.start;
      const result = await executor.execute(
        { id: "start", type: "start" } as any,
        { x: 1, y: "hello" },
        {} as any,
      );
      expect(result).toEqual({ x: 1, y: "hello" });
    });
  });

  // ========== 2. end ==========
  describe("end", () => {
    it("resolves outputs references via varCtx", async () => {
      const executor = executors.end;
      const varCtx = new VariableContext();
      varCtx.set("prev", { value: 42, label: "the answer" });

      const result = await executor.execute(
        {
          id: "end",
          type: "end",
          outputs: { answer: "{{#prev.value}}", label: "{{#prev.label}}" },
        } as any,
        {},
        { varCtx } as any,
      );
      expect(result).toEqual({ answer: 42, label: "the answer" });
    });

    it("returns empty object when outputs is undefined", async () => {
      const executor = executors.end;
      const varCtx = new VariableContext();
      const result = await executor.execute(
        { id: "end", type: "end" } as any,
        {},
        { varCtx } as any,
      );
      expect(result).toEqual({});
    });
  });

  // ========== 3. if_else ==========
  describe("if_else", () => {
    it("returns { branch: 'true' } for truthy condition", async () => {
      const executor = executors.if_else;
      const varCtx = new VariableContext();
      varCtx.set("gate", { score: 0.9 });

      const result = await executor.execute(
        { id: "gate", type: "if_else", condition: "gate.score > 0.5" } as any,
        {},
        { varCtx } as any,
      );
      expect(result).toEqual({ branch: "true" });
    });

    it("returns { branch: 'false' } for falsy condition", async () => {
      const executor = executors.if_else;
      const varCtx = new VariableContext();
      varCtx.set("gate", { score: 0.1 });

      const result = await executor.execute(
        { id: "gate", type: "if_else", condition: "gate.score > 0.5" } as any,
        {},
        { varCtx } as any,
      );
      expect(result).toEqual({ branch: "false" });
    });
  });

  // ========== 4. template ==========
  describe("template", () => {
    it("interpolates placeholders in template", async () => {
      const executor = executors.template;
      const varCtx = new VariableContext();
      varCtx.set("user", { name: "Alice", count: 3 });

      const result = await executor.execute(
        {
          id: "tpl",
          type: "template",
          template: "Hello {{#user.name}}, count={{#user.count}}",
        } as any,
        {},
        { varCtx } as any,
      );
      expect(result).toEqual({ result: "Hello Alice, count=3" });
    });
  });

  // ========== 5. set_variable ==========
  describe("set_variable", () => {
    it("writes assignments via varCtx.ref()", async () => {
      const executor = executors.set_variable;
      const varCtx = new VariableContext();
      varCtx.set("source", { val: 99 });

      const result = await executor.execute(
        {
          id: "sv",
          type: "set_variable",
          assignments: [
            { key: "a", value: "{{#source.val}}" },
            { key: "b", value: "literal" },
          ],
        } as any,
        {},
        { varCtx } as any,
      );
      expect(result).toEqual({ a: 99, b: "literal" });
    });
  });

  // ========== 6. code ==========
  describe("code", () => {
    it("executes user code and returns result", async () => {
      const executor = executors.code;
      const ctx = {
        signal: new AbortController().signal,
        nodeId: "code1",
        runId: "test",
        log: vi.fn(),
        varCtx: new VariableContext(),
        host: {} as any,
      };

      const result = await executor.execute(
        { id: "code1", type: "code", code: "return inputs.x + 1" } as any,
        { x: 41 },
        ctx as any,
      );
      expect(result).toEqual({ result: 42 });
    });

    it("returns object result directly", async () => {
      const executor = executors.code;
      const ctx = {
        signal: new AbortController().signal,
        nodeId: "code2",
        runId: "test",
        log: vi.fn(),
        varCtx: new VariableContext(),
        host: {} as any,
      };

      const result = await executor.execute(
        { id: "code2", type: "code", code: "return { foo: 'bar', num: 123 }" } as any,
        {},
        ctx as any,
      );
      expect(result).toEqual({ foo: "bar", num: 123 });
    });

    it("sandbox escape: require('fs') fails", async () => {
      const executor = executors.code;
      const ctx = {
        signal: new AbortController().signal,
        nodeId: "escape",
        runId: "test",
        log: vi.fn(),
        varCtx: new VariableContext(),
        host: {} as any,
      };

      await expect(
        executor.execute(
          { id: "escape", type: "code", code: "return require('fs').readdirSync('.')" } as any,
          {},
          ctx as any,
        ),
      ).rejects.toThrow();
    });

    it("sandbox blocks global access: process is undefined", async () => {
      const executor = executors.code;
      const ctx = {
        signal: new AbortController().signal,
        nodeId: "escape2",
        runId: "test",
        log: vi.fn(),
        varCtx: new VariableContext(),
        host: {} as any,
      };

      const result = await executor.execute(
        { id: "escape2", type: "code", code: "return typeof process" } as any,
        {},
        ctx as any,
      );
      // process 在沙箱中未定义，typeof 返回 "undefined"（非抛错，证明无泄漏）
      expect(result).toEqual({ result: "undefined" });
    });

    // ===== S1 沙箱逃逸探针：constructor 链不可达宿主 process =====
    it("S1: Date.constructor.constructor 不可达宿主 process", async () => {
      const executor = executors.code;
      const ctx = {
        signal: new AbortController().signal,
        nodeId: "s1-date",
        runId: "test",
        log: vi.fn(),
        varCtx: new VariableContext(),
        host: {} as any,
      };

      const result = await executor.execute(
        { id: "s1-date", type: "code", code: "return Date.constructor.constructor('return typeof process')()" } as any,
        {},
        ctx as any,
      );
      expect(result).toEqual({ result: "undefined" });
    });

    it("S1: Math.constructor.constructor 不可达宿主 process", async () => {
      const executor = executors.code;
      const ctx = {
        signal: new AbortController().signal,
        nodeId: "s1-math",
        runId: "test",
        log: vi.fn(),
        varCtx: new VariableContext(),
        host: {} as any,
      };

      const result = await executor.execute(
        { id: "s1-math", type: "code", code: "return Math.constructor.constructor('return typeof process')()" } as any,
        {},
        ctx as any,
      );
      expect(result).toEqual({ result: "undefined" });
    });

    it("S1: inputs.x.constructor.constructor 不可达宿主 process", async () => {
      const executor = executors.code;
      const ctx = {
        signal: new AbortController().signal,
        nodeId: "s1-inputs",
        runId: "test",
        log: vi.fn(),
        varCtx: new VariableContext(),
        host: {} as any,
      };

      const result = await executor.execute(
        { id: "s1-inputs", type: "code", code: "return inputs.x.constructor.constructor('return typeof process')()" } as any,
        { x: 1 },
        ctx as any,
      );
      // inputs.x 是纯数据（JSON 往返），.constructor.constructor 是 vm 的 Function，
      // 在其中 process 应为 undefined
      expect(result).toEqual({ result: "undefined" });
    });

    // ===== T5 修复验证：inputs 由 vm realm 重建，constructor 链闭环 =====
    it("T5①: inputs.constructor.constructor 不可达宿主 process", async () => {
      const executor = executors.code;
      const ctx = {
        signal: new AbortController().signal,
        nodeId: "t5-inputs-top",
        runId: "test",
        log: vi.fn(),
        varCtx: new VariableContext(),
        host: {} as any,
      };

      const result = await executor.execute(
        { id: "t5-inputs-top", type: "code", code: "return inputs.constructor.constructor('return typeof process')()" } as any,
        { x: 1 },
        ctx as any,
      );
      // 修1：宿主只传字符串，vm 内 JSON.parse 重建 inputs，constructor 链
      // 终点是 vm 自己的 Function，process 不可达
      expect(result).toEqual({ result: "undefined" });
    });

    it("T5②: 嵌套值 inputs.deep.x.constructor.constructor 同样封死", async () => {
      const executor = executors.code;
      const ctx = {
        signal: new AbortController().signal,
        nodeId: "t5-inputs-nested",
        runId: "test",
        log: vi.fn(),
        varCtx: new VariableContext(),
        host: {} as any,
      };

      const result = await executor.execute(
        { id: "t5-inputs-nested", type: "code", code: "return inputs.deep.x.constructor.constructor('return typeof process')()" } as any,
        { deep: { x: 1 } },
        ctx as any,
      );
      expect(result).toEqual({ result: "undefined" });
    });

    it("S1: RegExp.constructor.constructor 不可达宿主 process", async () => {
      const executor = executors.code;
      const ctx = {
        signal: new AbortController().signal,
        nodeId: "s1-regexp",
        runId: "test",
        log: vi.fn(),
        varCtx: new VariableContext(),
        host: {} as any,
      };

      const result = await executor.execute(
        { id: "s1-regexp", type: "code", code: "return RegExp.constructor.constructor('return typeof process')()" } as any,
        {},
        ctx as any,
      );
      expect(result).toEqual({ result: "undefined" });
    });

    it("abort signal terminates worker", async () => {
      const executor = executors.code;
      const ac = new AbortController();
      const ctx = {
        signal: ac.signal,
        nodeId: "abort",
        runId: "test",
        log: vi.fn(),
        varCtx: new VariableContext(),
        host: {} as any,
      };

      const runPromise = executor.execute(
        { id: "abort", type: "code", code: "while(true){}" } as any,
        {},
        ctx as any,
      );

      // abort after short delay
      setTimeout(() => ac.abort(), 50);

      await expect(runPromise).rejects.toThrow();
    }, 10000);
  });

  // ========== 7. iteration ==========
  describe("iteration", () => {
    it("iterates over array and aggregates outputs", async () => {
      const executor = executors.iteration;
      // 先注册 executor resolver
      const { setExecutorResolver } = await import("../src/executors/iteration.js");
      setExecutorResolver(() => ({
        type: "mock" as any,
        execute: async (_n: any, inputs: Record<string, any>) => ({
          result: inputs._item * 2,
        }),
      }));

      const varCtx = new VariableContext();
      varCtx.set("start", { items: [1, 2, 3] });

      const result = await executor.execute(
        {
          id: "loop",
          type: "iteration",
          over: "{{#start.items}}",
          body: [{ id: "step", type: "code", code: "return inputs._item * 2" }],
        } as any,
        {},
        { signal: new AbortController().signal, nodeId: "loop", varCtx } as any,
      );
      expect(result).toEqual({ items: [{ result: 2 }, { result: 4 }, { result: 6 }] });
    });

    it("throws when over limit (maxIterations=500)", async () => {
      const executor = executors.iteration;
      const { setExecutorResolver } = await import("../src/executors/iteration.js");
      setExecutorResolver(() => null as any);

      const varCtx = new VariableContext();
      varCtx.set("start", { items: new Array(600).fill(0) });

      await expect(
        executor.execute(
          {
            id: "loop",
            type: "iteration",
            over: "{{#start.items}}",
            maxIterations: 500,
            body: [{ id: "step", type: "code" }],
          } as any,
          {},
          { signal: new AbortController().signal, nodeId: "loop", varCtx } as any,
        ),
      ).rejects.toThrow(/超过最大限制/);
    });

    it("S3: throws on single-node-object body (not a valid shape)", async () => {
      const executor = executors.iteration;
      const { setExecutorResolver } = await import("../src/executors/iteration.js");
      setExecutorResolver(() => null as any);

      const varCtx = new VariableContext();
      varCtx.set("start", { items: [1] });

      await expect(
        executor.execute(
          {
            id: "loop",
            type: "iteration",
            over: "{{#start.items}}",
            body: { id: "step", type: "code" }, // 单节点对象——非法形状
          } as any,
          {},
          { signal: new AbortController().signal, nodeId: "loop", varCtx } as any,
        ),
      ).rejects.toThrow(/body 必须是节点数组或/);
    });

    it("S3: throws on undefined body", async () => {
      const executor = executors.iteration;
      const { setExecutorResolver } = await import("../src/executors/iteration.js");
      setExecutorResolver(() => null as any);

      const varCtx = new VariableContext();
      varCtx.set("start", { items: [1] });

      await expect(
        executor.execute(
          {
            id: "loop",
            type: "iteration",
            over: "{{#start.items}}",
            // body 未定义——非法形状
          } as any,
          {},
          { signal: new AbortController().signal, nodeId: "loop", varCtx } as any,
        ),
      ).rejects.toThrow(/body 必须是节点数组或/);
    });
  });

  // ========== 8. DSH executors (T6) ==========
  describe("DSH executors (T6) — host binding", () => {
    it.each([
      ["human", "human", "askUser"],
      ["llm", "llm", "llm"],
      ["subagent", "subagent", "subagents"],
      ["plugin_tool", "plugin_tool", "tools"],
    ])("%s throws hostNotBound when host service missing", async (_, type, service) => {
      const executor = executors[type as NType];
      // 提供 minimal ctx 使 executor 走到 host 取用点
      const varCtx = new VariableContext();
      const ctx = { host: {}, varCtx, signal: new AbortController().signal, nodeId: "test", runId: "test", log: () => {} } as any;
      await expect(
        executor.execute({ id: "test", type } as any, {}, ctx),
      ).rejects.toThrow(`host service "${service}" not bound`);
    });

    it("human with mock host.askUser returns approved", async () => {
      const executor = executors.human;
      const varCtx = new VariableContext();
      const askUser = async () => ({ decision: "approved" });
      const ctx = { host: { askUser }, varCtx, signal: new AbortController().signal, nodeId: "test", runId: "test", log: () => {} } as any;
      const result = await executor.execute(
        { id: "test", type: "human", prompt: "confirm?" } as any,
        {},
        ctx,
      );
      expect(result.decision).toBe("approved");
    });

    it("human with mock host.askUser returns rejected → throws", async () => {
      const executor = executors.human;
      const varCtx = new VariableContext();
      const askUser = async () => ({ decision: "rejected" });
      const ctx = { host: { askUser }, varCtx, signal: new AbortController().signal, nodeId: "test", runId: "test", log: () => {} } as any;
      await expect(
        executor.execute(
          { id: "test", type: "human", prompt: "confirm?" } as any,
          {},
          ctx,
        ),
      ).rejects.toThrow(/rejected/);
    });

    it("llm with mock host.llm.complete returns text", async () => {
      const executor = executors.llm;
      const varCtx = new VariableContext();
      const llm = { complete: async () => ({ text: "hello world" }) };
      const ctx = { host: { llm }, varCtx, signal: new AbortController().signal, nodeId: "test", runId: "test", log: () => {} } as any;
      const result = await executor.execute(
        { id: "test", type: "llm", prompt: "say hi" } as any,
        {},
        ctx,
      );
      expect(result.result).toBe("hello world");
    });

    it("llm with outputSchema validates result", async () => {
      const executor = executors.llm;
      const varCtx = new VariableContext();
      const llm = { complete: async () => ({ text: '{"name":"Alice","age":30}' }) };
      const ctx = { host: { llm }, varCtx, signal: new AbortController().signal, nodeId: "test", runId: "test", log: () => {} } as any;
      const result = await executor.execute(
        { id: "test", type: "llm", prompt: "get user", outputSchema: { type: "object", properties: { name: { type: "string" }, age: { type: "integer" } }, required: ["name", "age"] } } as any,
        {},
        ctx,
      );
      expect(result.result).toEqual({ name: "Alice", age: 30 });
    });

    it("llm outputSchema validation fails on type mismatch", async () => {
      const executor = executors.llm;
      const varCtx = new VariableContext();
      const llm = { complete: async () => ({ text: '{"name":123}' }) };
      const ctx = { host: { llm }, varCtx, signal: new AbortController().signal, nodeId: "test", runId: "test", log: () => {} } as any;
      await expect(
        executor.execute(
          { id: "test", type: "llm", prompt: "get user", outputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } } as any,
          {},
          ctx,
        ),
      ).rejects.toThrow(/outputSchema 校验失败/);
    });

    it("subagent with mock host.subagents.spawn returns result", async () => {
      const executor = executors.subagent;
      const varCtx = new VariableContext();
      const subagents = { spawn: async () => ({ result: { answer: 42 } }) };
      const ctx = { host: { subagents }, varCtx, signal: new AbortController().signal, nodeId: "test", runId: "test", log: () => {} } as any;
      const result = await executor.execute(
        { id: "test", type: "subagent", prompt: "do work" } as any,
        {},
        ctx,
      );
      expect(result.result).toEqual({ answer: 42 });
    });

    it("plugin_tool with mock host.tools.invoke returns output", async () => {
      const executor = executors.plugin_tool;
      const varCtx = new VariableContext();
      const tools = { invoke: async () => ({ data: "ok" }), has: () => true };
      const ctx = { host: { tools }, varCtx, signal: new AbortController().signal, nodeId: "test", runId: "test", log: () => {} } as any;
      const result = await executor.execute(
        { id: "test", type: "plugin_tool", toolName: "fs" } as any,
        { path: "/tmp" },
        ctx,
      );
      expect(result.data).toBe("ok");
    });
  });
});

describe("onError continue semantics", () => {
  it("failed node with onError:continue propagates to downstream", async () => {
    const workflow = dsl(
      [
        { id: "start", type: "start" },
        { id: "bad", type: "code", code: "throw", onError: "continue" },
        { id: "after", type: "code", code: "after" },
        { id: "end", type: "end" },
      ],
      [
        { id: "e1", source: "start", target: "bad" },
        { id: "e2", source: "bad", target: "after" },
        { id: "e3", source: "after", target: "end" },
      ],
    );

    const engine = new Engine(
      stubExecutors({
        start: { type: "start", execute: async () => ({ ok: true }) },
        code: {
          type: "code",
          execute: async (_n: any, _i: any, ctx: any) => {
            if (ctx.nodeId === "bad") throw new Error("boom");
            return { done: true };
          },
        },
        end: { type: "end", execute: async () => ({ finished: true }) },
      }),
    );

    const result = await engine.run(workflow, {});
    // onError "continue": bad 节点 failed，但引擎仍向下游释放出边
    expect(result.nodeStates.bad.status).toBe("failed");
    expect(result.nodeStates.bad.error).toContain("boom");
    expect(result.nodeStates.after.status).toBe("success");
    expect(result.nodeStates.end.status).toBe("success");
    // 整体 status = failed（有节点 failed，引擎不降级为 success）
    expect(result.status).toBe("failed");
  });

  it("default onError (stop) blocks downstream propagation", async () => {
    const workflow = dsl(
      [
        { id: "start", type: "start" },
        { id: "bad", type: "code", code: "throw" },
        { id: "after", type: "code", code: "after" },
        { id: "end", type: "end" },
      ],
      [
        { id: "e1", source: "start", target: "bad" },
        { id: "e2", source: "bad", target: "after" },
        { id: "e3", source: "after", target: "end" },
      ],
    );

    const engine = new Engine(
      stubExecutors({
        start: { type: "start", execute: async () => ({ ok: true }) },
        code: {
          type: "code",
          execute: async (_n: any, _i: any, ctx: any) => {
            if (ctx.nodeId === "bad") throw new Error("boom");
            return { done: true };
          },
        },
        end: { type: "end", execute: async () => ({ finished: true }) },
      }),
    );

    const result = await engine.run(workflow, {});
    expect(result.status).toBe("failed");
    expect(result.nodeStates.bad.status).toBe("failed");
    expect(result.nodeStates.after.status).toBe("pending");
    expect(result.nodeStates.end.status).toBe("pending");
  });
});

describe("DPE branch routing (if_else → true/false)", () => {
  it("routes through true branch and skips false branch", async () => {
    const workflow = dsl(
      [
        { id: "start", type: "start" },
        { id: "gate", type: "if_else", condition: "1 == 1" },
        { id: "on_true", type: "code", code: "true path" },
        { id: "on_false", type: "code", code: "false path" },
        { id: "end", type: "end" },
      ],
      [
        { id: "e1", source: "start", target: "gate" },
        { id: "e2", source: "gate", target: "on_true", branch: "true" },
        { id: "e3", source: "gate", target: "on_false", branch: "false" },
        { id: "e4", source: "on_true", target: "end" },
        { id: "e5", source: "on_false", target: "end" },
      ],
    );

    const executed: string[] = [];
    const engine = new Engine(
      stubExecutors({
        start: { type: "start", execute: async () => ({ ok: true }) },
        if_else: { type: "if_else", execute: async () => ({ branch: "true" }) },
        code: {
          type: "code",
          execute: async (_n: any, _i: any, ctx: any) => {
            executed.push(ctx.nodeId);
            return { done: true };
          },
        },
        end: { type: "end", execute: async () => ({ finished: true }) },
      }),
    );

    const result = await engine.run(workflow, {});
    expect(result.status).toBe("success");
    expect(result.nodeStates.on_true.status).toBe("success");
    expect(result.nodeStates.on_false.status).toBe("skipped");
    expect(executed).toContain("on_true");
    expect(executed).not.toContain("on_false");
    expect(result.nodeStates.end.status).toBe("success");
  });
});

describe("code executor through engine integration", () => {
  it("runs code executor in a real workflow", async () => {
    const workflow = dsl(
      [
        { id: "start", type: "start" },
        { id: "calc", type: "code", code: "return 21 * 2" },
        { id: "end", type: "end" },
      ],
      [
        { id: "e1", source: "start", target: "calc" },
        { id: "e2", source: "calc", target: "end" },
      ],
    );

    const realExecutors = createExecutors();
    // Override human/llm/subagent/plugin_tool with stubs that return empty
    // (they are not used in this test, but registerAll needs them)
    const overrides: Partial<Record<NType, Executor>> = {
      human: { type: "human", execute: async () => ({}) },
      llm: { type: "llm", execute: async () => ({}) },
      subagent: { type: "subagent", execute: async () => ({}) },
      plugin_tool: { type: "plugin_tool", execute: async () => ({}) },
    };

    const engine = new Engine({ ...realExecutors, ...overrides });
    const result = await engine.run(workflow, { x: 21 });
    expect(result.status).toBe("success");
    expect(result.outputs.calc).toEqual({ result: 42 });
    expect(result.nodeStates.calc.status).toBe("success");
  });
});

// ===== T5③: deepFreeze 环防护（修3） =====
// 真实入参经 JSON 往返必为树形，循环引用无法经 executor 路径构造；
// 此单测直接以同款实现验证 primordial 脚本中 deepFreeze 的环防护逻辑。
describe("T5③ deepFreeze cycle guard", () => {
  it("循环引用对象不再导致深冻结无限递归 RangeError", async () => {
    const vm = await import("node:vm");

    // 在 vm realm 内构造循环引用对象（自环 + 经数组/嵌套的间接环）
    const circularSetup = `
      var a = {};
      a.self = a;
      a.list = [a, { inner: a }];
    `;

    // 负向对照：无 WeakSet 防护的朴素 deepFreeze 在环上必须抛 RangeError
    // （跨 realm 异常无法 instanceof，按消息断言）
    const naiveSandbox: any = Object.create(null);
    vm.createContext(naiveSandbox);
    expect(() =>
      vm.runInContext(
        circularSetup +
          `
        (function() {
          function naiveFreeze(obj) {
            if (obj === null || typeof obj !== 'object') return;
            for (var key of Object.getOwnPropertyNames(obj)) {
              naiveFreeze(obj[key]);
            }
            Object.freeze(obj);
          }
          naiveFreeze(a);
        })();
        `,
        naiveSandbox,
      ),
    ).toThrow(/call stack|recursion/i);

    // 修3：带 WeakSet 已访集合的 deepFreeze 遇环直接跳过，正常冻结完成
    const safeSandbox: any = Object.create(null);
    vm.createContext(safeSandbox);
    const ok = vm.runInContext(
      circularSetup +
        `
      (function() {
        function deepFreeze(obj, seen) {
          if (obj === null || (typeof obj !== 'object' && typeof obj !== 'function')) return;
          if (seen.has(obj)) return;
          seen.add(obj);
          for (var key of Object.getOwnPropertyNames(obj)) {
            var v = obj[key];
            if (v !== null && (typeof v === 'object' || typeof v === 'function')) {
              deepFreeze(v, seen);
            }
          }
          Object.freeze(obj);
        }
        deepFreeze(a, new WeakSet());
        return Object.isFrozen(a) && a.self === a && Object.isFrozen(a.list[1].inner);
      })()
      `,
      safeSandbox,
    );
    expect(ok).toBe(true);
  });
});