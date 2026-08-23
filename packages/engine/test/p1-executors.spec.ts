import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { WorkflowEngine as Engine, createExecutors, VariableContext } from "../src/index.js";
import type { WorkflowDSL as DSL } from "@dsh-workflow/schema";
import type { ExecutionContext, NodeOutput } from "../src/index.js";

function dsl(
  nodes: Array<Record<string, unknown>>,
  edges: Array<Record<string, unknown>>,
): DSL {
  return {
    version: "dsh.workflow.v1",
    name: "p1_test",
    nodes: nodes as unknown as DSL["nodes"],
    edges: edges as unknown as DSL["edges"],
  };
}

describe("P1 Executors & Engine Extensions", () => {
  const executors = createExecutors();

  // ================= 1. switch =================
  describe("1. switch executor & DPE branch routing", () => {
    it("matches case condition and outputs { branch: matchedValue }", async () => {
      const varCtx = new VariableContext();
      varCtx.set("score_node", { score: 95 });

      const ctx = {
        nodeId: "switch_1",
        runId: "r1",
        signal: new AbortController().signal,
        log: vi.fn(),
        varCtx,
        host: {},
      } as unknown as ExecutionContext;

      const node = {
        id: "switch_1",
        type: "switch" as const,
        cases: [
          { when: "score_node.score > 90", value: "high" },
          { when: "score_node.score > 60", value: "medium" },
        ],
        defaultCase: "low",
      };

      const res = await executors.switch.execute(node as any, {}, ctx);
      expect(res).toEqual({ branch: "high" });
    });

    it("matches case string with expression", async () => {
      const varCtx = new VariableContext();
      varCtx.set("user", { role: "admin" });

      const ctx = {
        nodeId: "switch_2",
        runId: "r1",
        signal: new AbortController().signal,
        log: vi.fn(),
        varCtx,
        host: {},
      } as unknown as ExecutionContext;

      const node = {
        id: "switch_2",
        type: "switch" as const,
        expression: "user.role",
        cases: ["guest", "admin", "owner"],
        defaultCase: "unknown",
      };

      const res = await executors.switch.execute(node as any, {}, ctx);
      expect(res).toEqual({ branch: "admin" });
    });

    it("falls back to defaultCase when no cases match", async () => {
      const varCtx = new VariableContext();
      varCtx.set("score_node", { score: 40 });

      const ctx = {
        nodeId: "switch_3",
        runId: "r1",
        signal: new AbortController().signal,
        log: vi.fn(),
        varCtx,
        host: {},
      } as unknown as ExecutionContext;

      const node = {
        id: "switch_3",
        type: "switch" as const,
        cases: [{ when: "score_node.score > 90", value: "high" }],
        defaultCase: "fallback_branch",
      };

      const res = await executors.switch.execute(node as any, {}, ctx);
      expect(res).toEqual({ branch: "fallback_branch" });
    });

    it("switch node routes DPE edges end-to-end in engine", async () => {
      const workflow = dsl(
        [
          { id: "start", type: "start" },
          {
            id: "sw",
            type: "switch",
            cases: [
              { when: "start.level == 'VIP'", value: "vip_branch" },
              { when: "start.level == 'GUEST'", value: "guest_branch" },
            ],
            defaultCase: "default_branch",
          },
          { id: "vip_action", type: "code", code: "return { vip: true };" },
          { id: "guest_action", type: "code", code: "return { guest: true };" },
          { id: "end", type: "end" },
        ],
        [
          { id: "e1", source: "start", target: "sw" },
          { id: "e2", source: "sw", target: "vip_action", branch: "vip_branch" },
          { id: "e3", source: "sw", target: "guest_action", branch: "guest_branch" },
          { id: "e4", source: "vip_action", target: "end" },
          { id: "e5", source: "guest_action", target: "end" },
        ],
      );

      const engine = new Engine(executors);
      const res = await engine.run(workflow, { level: "VIP" });

      expect(res.status).toBe("success");
      expect(res.nodeStates.vip_action.status).toBe("success");
      expect(res.nodeStates.guest_action.status).toBe("skipped");
      expect(res.nodeStates.end.status).toBe("success");
    });
  });

  // ================= 2. wait =================
  describe("2. wait executor", () => {
    it("waits for waitMs milliseconds", async () => {
      const ctx = {
        nodeId: "wait_1",
        runId: "r1",
        signal: new AbortController().signal,
        log: vi.fn(),
        varCtx: new VariableContext(),
        host: {},
      } as unknown as ExecutionContext;

      const started = Date.now();
      const res = await executors.wait.execute(
        { id: "wait_1", type: "wait", waitMs: 20 } as any,
        {},
        ctx,
      );
      const elapsed = Date.now() - started;
      expect(elapsed).toBeGreaterThanOrEqual(15);
      expect(res.waitedMs).toBe(20);
    });

    it("aborts when signal is triggered", async () => {
      const controller = new AbortController();
      const ctx = {
        nodeId: "wait_abort",
        runId: "r1",
        signal: controller.signal,
        log: vi.fn(),
        varCtx: new VariableContext(),
        host: {},
      } as unknown as ExecutionContext;

      const p = executors.wait.execute(
        { id: "wait_abort", type: "wait", waitMs: 1000 } as any,
        {},
        ctx,
      );

      setTimeout(() => controller.abort(), 15);
      await expect(p).rejects.toThrow(/中止/);
    });

    it("waits until ISO timestamp in future", async () => {
      const targetTime = new Date(Date.now() + 20).toISOString();
      const ctx = {
        nodeId: "wait_until",
        runId: "r1",
        signal: new AbortController().signal,
        log: vi.fn(),
        varCtx: new VariableContext(),
        host: {},
      } as unknown as ExecutionContext;

      const res = await executors.wait.execute(
        { id: "wait_until", type: "wait", until: targetTime } as any,
        {},
        ctx,
      );
      expect(res.waitedMs).toBeGreaterThanOrEqual(0);
      expect(res.completedAt).toBeDefined();
    });
  });

  // ================= 3. merge =================
  describe("3. merge executor", () => {
    it("merges predecessor outputs shallowly by default", async () => {
      const varCtx = new VariableContext();
      varCtx.set("node_a", { a: 1, shared: "from_a" });
      varCtx.set("node_b", { b: 2, shared: "from_b" });

      const ctx = {
        nodeId: "merge_1",
        runId: "r1",
        signal: new AbortController().signal,
        log: vi.fn(),
        varCtx,
        host: {},
      } as unknown as ExecutionContext;

      const res = await executors.merge.execute(
        { id: "merge_1", type: "merge", strategy: "shallow" } as any,
        { _predecessors: ["node_a", "node_b"], explicit: "val" },
        ctx,
      );

      expect(res).toEqual({
        a: 1,
        b: 2,
        shared: "from_b",
        explicit: "val",
      });
    });

    it("merges predecessor outputs deeply when strategy is deep", async () => {
      const varCtx = new VariableContext();
      varCtx.set("node_a", { nested: { x: 1, y: 2 } });
      varCtx.set("node_b", { nested: { y: 20, z: 30 } });

      const ctx = {
        nodeId: "merge_2",
        runId: "r1",
        signal: new AbortController().signal,
        log: vi.fn(),
        varCtx,
        host: {},
      } as unknown as ExecutionContext;

      const res = await executors.merge.execute(
        { id: "merge_2", type: "merge", strategy: "deep" } as any,
        { _predecessors: ["node_a", "node_b"] },
        ctx,
      );

      expect(res).toEqual({
        nested: {
          x: 1,
          y: 20,
          z: 30,
        },
      });
    });
  });

  // ================= 4. error_fallback & onError: "route" =================
  describe("4. error_fallback & onError: 'route'", () => {
    it("error_fallback returns error info passed in inputs", async () => {
      const ctx = {
        nodeId: "ef_1",
        runId: "r1",
        signal: new AbortController().signal,
        log: vi.fn(),
        varCtx: new VariableContext(),
        host: {},
      } as unknown as ExecutionContext;

      const res = await executors.error_fallback.execute(
        { id: "ef_1", type: "error_fallback" } as any,
        { error: "DB connection timeout", errorNode: "db_query" },
        ctx,
      );

      expect(res).toEqual({
        error: "DB connection timeout",
        errorNode: "db_query",
        handled: true,
      });
    });

    it("onError: 'route' end-to-end: failed node routes to error_fallback with branch='error'", async () => {
      const workflow = dsl(
        [
          { id: "start", type: "start" },
          {
            id: "flaky_node",
            type: "code",
            code: "throw new Error('Something went wrong in service');",
            onError: "route",
          },
          {
            id: "normal_downstream",
            type: "code",
            code: "return { ok: true };",
          },
          {
            id: "fallback_node",
            type: "error_fallback",
          },
          {
            id: "end",
            type: "end",
          },
        ],
        [
          { id: "e1", source: "start", target: "flaky_node" },
          { id: "e2", source: "flaky_node", target: "normal_downstream" },
          { id: "e3", source: "flaky_node", target: "fallback_node", branch: "error" },
          { id: "e4", source: "fallback_node", target: "end" },
        ],
      );

      const engine = new Engine(executors);
      const res = await engine.run(workflow, {});

      expect(res.nodeStates.flaky_node.status).toBe("failed");
      expect(res.nodeStates.flaky_node.error).toContain("Something went wrong");
      expect(res.nodeStates.normal_downstream.status).toBe("skipped");
      expect(res.nodeStates.fallback_node.status).toBe("success");
      expect(res.outputs.fallback_node.error).toContain("Something went wrong");
      expect(res.outputs.fallback_node.errorNode).toBe("flaky_node");
      expect(res.nodeStates.end.status).toBe("success");
    });
  });

  // ================= 5. intent_classifier =================
  describe("5. intent_classifier", () => {
    it("calls host.llm.complete and parses category", async () => {
      const varCtx = new VariableContext();
      varCtx.set("input_node", { text: "I would like to return my order" });

      const mockComplete = vi.fn().mockResolvedValue({ text: "refund" });

      const ctx = {
        nodeId: "intent_1",
        runId: "r1",
        signal: new AbortController().signal,
        log: vi.fn(),
        varCtx,
        host: {
          llm: { complete: mockComplete },
        },
      } as unknown as ExecutionContext;

      const node = {
        id: "intent_1",
        type: "intent_classifier" as const,
        categories: ["refund", "support", "sales"],
        prompt: "Classify: {{#input_node.text}}",
      };

      const res = await executors.intent_classifier.execute(node as any, {}, ctx);
      expect(res).toEqual({ category: "refund" });
      expect(mockComplete).toHaveBeenCalledTimes(1);
    });

    it("retries once when first LLM output is invalid", async () => {
      const varCtx = new VariableContext();
      const mockComplete = vi
        .fn()
        .mockResolvedValueOnce({ text: "I think it is maybe a return request" })
        .mockResolvedValueOnce({ text: "refund" });

      const ctx = {
        nodeId: "intent_2",
        runId: "r1",
        signal: new AbortController().signal,
        log: vi.fn(),
        varCtx,
        host: {
          llm: { complete: mockComplete },
        },
      } as unknown as ExecutionContext;

      const node = {
        id: "intent_2",
        type: "intent_classifier" as const,
        categories: ["refund", "support", "sales"],
        prompt: "Classify query",
      };

      const res = await executors.intent_classifier.execute(node as any, {}, ctx);
      expect(res).toEqual({ category: "refund" });
      expect(mockComplete).toHaveBeenCalledTimes(2);
    });

    it("throws when LLM output remains invalid after retry", async () => {
      const varCtx = new VariableContext();
      const mockComplete = vi.fn().mockResolvedValue({ text: "gibberish" });

      const ctx = {
        nodeId: "intent_3",
        runId: "r1",
        signal: new AbortController().signal,
        log: vi.fn(),
        varCtx,
        host: {
          llm: { complete: mockComplete },
        },
      } as unknown as ExecutionContext;

      const node = {
        id: "intent_3",
        type: "intent_classifier" as const,
        categories: ["refund", "support"],
        prompt: "Classify query",
      };

      await expect(
        executors.intent_classifier.execute(node as any, {}, ctx),
      ).rejects.toThrow(/不在合法类别列表/);
    });
  });

  // ================= 6. parameter_extractor =================
  describe("6. parameter_extractor", () => {
    it("calls host.llm.complete and validates output against schema", async () => {
      const varCtx = new VariableContext();
      varCtx.set("start", { emailText: "My email is test@example.com and age is 25" });

      const mockComplete = vi.fn().mockResolvedValue({
        text: JSON.stringify({ email: "test@example.com", age: 25 }),
      });

      const ctx = {
        nodeId: "extractor_1",
        runId: "r1",
        signal: new AbortController().signal,
        log: vi.fn(),
        varCtx,
        host: {
          llm: { complete: mockComplete },
        },
      } as unknown as ExecutionContext;

      const node = {
        id: "extractor_1",
        type: "parameter_extractor" as const,
        schema: {
          type: "object",
          properties: {
            email: { type: "string" },
            age: { type: "integer" },
          },
          required: ["email", "age"],
        },
        prompt: "Extract from: {{#start.emailText}}",
      };

      const res = await executors.parameter_extractor.execute(node as any, {}, ctx);
      expect(res).toMatchObject({
        email: "test@example.com",
        age: 25,
      });
    });

    it("throws error when model output violates JSON Schema", async () => {
      const varCtx = new VariableContext();
      const mockComplete = vi.fn().mockResolvedValue({
        text: JSON.stringify({ email: 12345 }), // invalid type
      });

      const ctx = {
        nodeId: "extractor_2",
        runId: "r1",
        signal: new AbortController().signal,
        log: vi.fn(),
        varCtx,
        host: {
          llm: { complete: mockComplete },
        },
      } as unknown as ExecutionContext;

      const node = {
        id: "extractor_2",
        type: "parameter_extractor" as const,
        schema: {
          type: "object",
          properties: {
            email: { type: "string" },
          },
          required: ["email"],
        },
        prompt: "Extract",
      };

      await expect(
        executors.parameter_extractor.execute(node as any, {}, ctx),
      ).rejects.toThrow(/期望类型 string/);
    });
  });

  // ================= 7. http_request =================
  describe("7. http_request", () => {
    let server: http.Server;
    let serverPort: number;

    beforeAll(async () => {
      server = http.createServer((req, res) => {
        if (req.url === "/api/json") {
          let body = "";
          req.on("data", (chunk) => (body += chunk));
          req.on("end", () => {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ received: body ? JSON.parse(body) : null, ok: true }));
          });
        } else if (req.url === "/api/text") {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("plain text response");
        } else {
          res.writeHead(404);
          res.end("not found");
        }
      });

      await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
          const addr = server.address() as { port: number };
          serverPort = addr.port;
          resolve();
        });
      });
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it("performs GET request and parses JSON data", async () => {
      const ctx = {
        nodeId: "http_1",
        runId: "r1",
        signal: new AbortController().signal,
        log: vi.fn(),
        varCtx: new VariableContext(),
        host: {},
      } as unknown as ExecutionContext;

      const node = {
        id: "http_1",
        type: "http_request" as const,
        url: `http://127.0.0.1:${serverPort}/api/json`,
        method: "GET",
      };

      const res = await executors.http_request.execute(node as any, {}, ctx);
      expect(res.status).toBe(200);
      expect(res.ok).toBe(true);
      expect(res.data).toEqual({ received: null, ok: true });
    });

    it("performs POST request with interpolated body", async () => {
      const varCtx = new VariableContext();
      varCtx.set("user", { name: "Alice", id: 101 });

      const ctx = {
        nodeId: "http_2",
        runId: "r1",
        signal: new AbortController().signal,
        log: vi.fn(),
        varCtx,
        host: {},
      } as unknown as ExecutionContext;

      const node = {
        id: "http_2",
        type: "http_request" as const,
        url: `http://127.0.0.1:${serverPort}/api/json`,
        method: "POST",
        body: { username: "{{#user.name}}", uid: 101 },
      };

      const res = await executors.http_request.execute(node as any, {}, ctx);
      expect(res.status).toBe(200);
      expect(res.data).toEqual({
        received: { username: "Alice", uid: 101 },
        ok: true,
      });
    });

    it("performs GET request and handles plain text data", async () => {
      const ctx = {
        nodeId: "http_3",
        runId: "r1",
        signal: new AbortController().signal,
        log: vi.fn(),
        varCtx: new VariableContext(),
        host: {},
      } as unknown as ExecutionContext;

      const node = {
        id: "http_3",
        type: "http_request" as const,
        url: `http://127.0.0.1:${serverPort}/api/text`,
        method: "GET",
      };

      const res = await executors.http_request.execute(node as any, {}, ctx);
      expect(res.status).toBe(200);
      expect(res.ok).toBe(true);
      expect(res.data).toBe("plain text response");
    });

    it("aborts when parent signal is aborted", async () => {
      const controller = new AbortController();
      const ctx = {
        nodeId: "http_abort",
        runId: "r1",
        signal: controller.signal,
        log: vi.fn(),
        varCtx: new VariableContext(),
        host: {},
      } as unknown as ExecutionContext;

      const node = {
        id: "http_abort",
        type: "http_request" as const,
        url: `http://127.0.0.1:${serverPort}/api/json`,
        method: "GET",
      };

      controller.abort();
      await expect(executors.http_request.execute(node as any, {}, ctx)).rejects.toThrow();
    });
  });

  // ================= 8. sub_workflow =================
  describe("8. sub_workflow", () => {
    it("executes inline child workflow and returns child outputs", async () => {
      const childDsl: DSL = {
        version: "dsh.workflow.v1",
        name: "child_subflow",
        nodes: [
          { id: "child_start", type: "start" },
          {
            id: "child_calc",
            type: "code",
            code: "return { double: inputs.val * 2 };",
            inputs: { val: "{{#child_start.val}}" },
          },
          {
            id: "child_end",
            type: "end",
            outputs: { result: "{{#child_calc.double}}" },
          },
        ],
        edges: [
          { id: "ce1", source: "child_start", target: "child_calc" },
          { id: "ce2", source: "child_calc", target: "child_end" },
        ],
      };

      const varCtx = new VariableContext();
      varCtx.set("parent_start", { count: 21 });

      const ctx = {
        nodeId: "sub_1",
        runId: "r1",
        signal: new AbortController().signal,
        log: vi.fn(),
        varCtx,
        callStack: ["parent_workflow"],
        host: {},
      } as unknown as ExecutionContext;

      const node = {
        id: "sub_1",
        type: "sub_workflow" as const,
        inlineDsl: childDsl,
      };

      const res = await executors.sub_workflow.execute(
        node as any,
        { val: 21 },
        ctx,
      );

      expect(res.result).toBe(42);
    });

    it("resolves child workflow via host.resolveWorkflow", async () => {
      const childDsl: DSL = {
        version: "dsh.workflow.v1",
        name: "resolved_subflow",
        nodes: [
          { id: "child_start", type: "start" },
          { id: "child_end", type: "end", outputs: { message: "resolved_ok" } },
        ],
        edges: [
          { id: "ce1", source: "child_start", target: "child_end" },
        ],
      };

      const mockResolve = vi.fn().mockResolvedValue(childDsl);
      const ctx = {
        nodeId: "sub_resolve",
        runId: "r1",
        signal: new AbortController().signal,
        log: vi.fn(),
        varCtx: new VariableContext(),
        callStack: [],
        host: {
          resolveWorkflow: mockResolve,
        },
      } as unknown as ExecutionContext;

      const node = {
        id: "sub_resolve",
        type: "sub_workflow" as const,
        workflow: "my_named_subflow",
      };

      const res = await executors.sub_workflow.execute(node as any, {}, ctx);
      expect(mockResolve).toHaveBeenCalledWith("my_named_subflow");
      expect(res.message).toBe("resolved_ok");
    });

    it("throws error when maxDepth is exceeded", async () => {
      const childDsl: DSL = {
        version: "dsh.workflow.v1",
        name: "deep_flow",
        nodes: [
          { id: "s", type: "start" },
          { id: "e", type: "end" },
        ],
        edges: [{ id: "e1", source: "s", target: "e" }],
      };

      const ctx = {
        nodeId: "sub_deep",
        runId: "r1",
        signal: new AbortController().signal,
        log: vi.fn(),
        varCtx: new VariableContext(),
        callStack: ["level_0", "level_1", "level_2"], // length 3
        host: {},
      } as unknown as ExecutionContext;

      const node = {
        id: "sub_deep",
        type: "sub_workflow" as const,
        inlineDsl: childDsl,
        maxDepth: 3,
      };

      await expect(
        executors.sub_workflow.execute(node as any, {}, ctx),
      ).rejects.toThrow(/调用深度超过上限 3/);
    });

    it("throws error when recursion cycle is detected", async () => {
      const childDsl: DSL = {
        version: "dsh.workflow.v1",
        name: "cycle_flow",
        nodes: [
          { id: "s", type: "start" },
          { id: "e", type: "end" },
        ],
        edges: [{ id: "e1", source: "s", target: "e" }],
      };

      const ctx = {
        nodeId: "sub_cycle",
        runId: "r1",
        signal: new AbortController().signal,
        log: vi.fn(),
        varCtx: new VariableContext(),
        callStack: ["root", "cycle_flow"],
        host: {},
      } as unknown as ExecutionContext;

      const node = {
        id: "sub_cycle",
        type: "sub_workflow" as const,
        inlineDsl: childDsl,
      };

      await expect(
        executors.sub_workflow.execute(node as any, {}, ctx),
      ).rejects.toThrow(/检测到递归环路/);
    });
  });

  // ================= 9. schedule_trigger & webhook_trigger =================
  describe("9. schedule_trigger & webhook_trigger (declarative stubs)", () => {
    it("schedule_trigger validates cron and returns trigger metadata", async () => {
      const ctx = {
        nodeId: "sched_1",
        runId: "r1",
        signal: new AbortController().signal,
        log: vi.fn(),
        varCtx: new VariableContext(),
        host: {},
      } as unknown as ExecutionContext;

      const node = {
        id: "sched_1",
        type: "schedule_trigger" as const,
        cron: "0 0 * * *",
      };

      const res = await executors.schedule_trigger.execute(node as any, {}, ctx);
      expect(res.triggered).toBe(true);
      expect(res.config).toEqual({ cron: "0 0 * * *" });
    });

    it("schedule_trigger rejects empty cron", async () => {
      const ctx = {
        nodeId: "sched_bad",
        runId: "r1",
        signal: new AbortController().signal,
        log: vi.fn(),
        varCtx: new VariableContext(),
        host: {},
      } as unknown as ExecutionContext;

      await expect(
        executors.schedule_trigger.execute(
          { id: "sched_bad", type: "schedule_trigger", cron: "  " } as any,
          {},
          ctx,
        ),
      ).rejects.toThrow(/cron 表达式不能为空/);
    });

    it("webhook_trigger validates name and returns payload", async () => {
      const ctx = {
        nodeId: "wh_1",
        runId: "r1",
        signal: new AbortController().signal,
        log: vi.fn(),
        varCtx: new VariableContext(),
        host: {},
      } as unknown as ExecutionContext;

      const node = {
        id: "wh_1",
        type: "webhook_trigger" as const,
        name: "github_push",
        secret: "supersecret",
      };

      const res = await executors.webhook_trigger.execute(
        node as any,
        { body: { ref: "refs/heads/main" }, headers: { "x-event": "push" } },
        ctx,
      );

      expect(res.triggered).toBe(true);
      expect(res.config).toEqual({
        name: "github_push",
        path: null,
        secret: "***",
      });
      expect(res.body).toEqual({ ref: "refs/heads/main" });
      expect(res.headers).toEqual({ "x-event": "push" });
    });

    it("webhook_trigger rejects empty name/path", async () => {
      const ctx = {
        nodeId: "wh_bad",
        runId: "r1",
        signal: new AbortController().signal,
        log: vi.fn(),
        varCtx: new VariableContext(),
        host: {},
      } as unknown as ExecutionContext;

      await expect(
        executors.webhook_trigger.execute(
          { id: "wh_bad", type: "webhook_trigger" } as any,
          {},
          ctx,
        ),
      ).rejects.toThrow(/name 或 path 不能为空/);
    });
  });
});
