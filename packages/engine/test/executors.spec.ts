import { describe, it, expect, vi } from "vitest";

import { WorkflowEngine as Engine } from "../src/index.js";
import { createExecutors, NotImplementedError } from "../src/index.js";
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
  });

  // ========== 8. stub executors ==========
  describe("stub executors (T6)", () => {
    it.each([
      ["human", "human"],
      ["llm", "llm"],
      ["subagent", "subagent"],
      ["plugin_tool", "plugin_tool"],
    ])("%s throws NotImplementedError", async (_, type) => {
      const executor = executors[type as NType];
      await expect(
        executor.execute({} as any, {}, {} as any),
      ).rejects.toThrow(NotImplementedError);
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
