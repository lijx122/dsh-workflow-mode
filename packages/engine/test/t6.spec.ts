import { describe, it, expect, vi } from "vitest";

import { WorkflowEngine as Engine, createExecutors } from "../src/index.js";
import type { HostServices } from "../src/index.js";
import type { WorkflowDSL as DSL } from "@dsh-workflow/schema";
import { VariableContext } from "../src/index.js";

/**
 * T6：DSH 服务绑定层——四执行器经 Engine 注入的 host 适配器取用服务。
 * 单测不依赖真实 dsh 运行时，全部以 mock host 驱动；另含 Engine 级注入贯通验证。
 */

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

/** mock ctx：除 host 由各用例注入外，其余字段齐全 */
function mockCtx(host: HostServices) {
  return {
    runId: "run-1",
    nodeId: "n1",
    signal: new AbortController().signal,
    log: vi.fn(),
    varCtx: new VariableContext(),
    host,
  };
}

// ================= llm =================

describe("llm executor · T6 host binding", () => {
  it("① 无 outputSchema：result = 模型原始文本", async () => {
    const complete = vi.fn().mockResolvedValue({ text: "hello world" });
    const executor = createExecutors().llm;
    const ctx = mockCtx({ llm: { complete } });

    const out = await executor.execute(
      { id: "n1", type: "llm", prompt: "say hi" } as never,
      {},
      ctx as never,
    );

    expect(out).toEqual({ result: "hello world" });
    expect(complete).toHaveBeenCalledWith({
      model: undefined,
      prompt: "say hi",
      systemPrompt: undefined,
      outputSchema: undefined,
    });
  });

  it("② prompt 插值 + model/systemPrompt 透传", async () => {
    const complete = vi.fn().mockResolvedValue({ text: "ok" });
    const executor = createExecutors().llm;
    const ctx = mockCtx({ llm: { complete } });
    ctx.varCtx.set("start", { name: "Alice" });

    await executor.execute(
      {
        id: "n1",
        type: "llm",
        prompt: "Hello {{#start.name}}",
        systemPrompt: "You are {{#start.name}}'s assistant",
        model: "deepseek-v4",
      } as never,
      {},
      ctx as never,
    );

    expect(complete).toHaveBeenCalledWith({
      model: "deepseek-v4",
      prompt: "Hello Alice",
      systemPrompt: "You are Alice's assistant",
      outputSchema: undefined,
    });
  });

  it("③ outputSchema 存在：JSON 解析 + schema 校验通过 → result = 结构化对象", async () => {
    const complete = vi
      .fn()
      .mockResolvedValue({ text: '{"name":"Alice","age":30}' });
    const executor = createExecutors().llm;
    const ctx = mockCtx({ llm: { complete } });

    const out = await executor.execute(
      {
        id: "n1",
        type: "llm",
        prompt: "get user",
        outputSchema: {
          type: "object",
          required: ["name", "age"],
          properties: { name: { type: "string" }, age: { type: "integer" } },
        },
      } as never,
      {},
      ctx as never,
    );

    expect(out).toEqual({ result: { name: "Alice", age: 30 } });
  });

  it("④ schema 校验失败：字段类型不符 → 抛带路径的错误", async () => {
    const complete = vi.fn().mockResolvedValue({ text: '{"name":123}' });
    const executor = createExecutors().llm;
    const ctx = mockCtx({ llm: { complete } });

    await expect(
      executor.execute(
        {
          id: "n1",
          type: "llm",
          prompt: "get user",
          outputSchema: {
            type: "object",
            required: ["name"],
            properties: { name: { type: "string" } },
          },
        } as never,
        {},
        ctx as never,
      ),
    ).rejects.toThrow(/outputSchema 校验失败于 \$\.name/);
  });

  it("⑤ schema 校验失败：缺必填字段 → 抛错", async () => {
    const complete = vi.fn().mockResolvedValue({ text: '{"age":30}' });
    const executor = createExecutors().llm;
    const ctx = mockCtx({ llm: { complete } });

    await expect(
      executor.execute(
        {
          id: "n1",
          type: "llm",
          prompt: "get user",
          outputSchema: {
            type: "object",
            required: ["name"],
            properties: { name: { type: "string" } },
          },
        } as never,
        {},
        ctx as never,
      ),
    ).rejects.toThrow(/缺少必填属性 "name"/);
  });

  it("⑥ outputSchema 存在但模型返回非 JSON → 解析失败抛错", async () => {
    const complete = vi.fn().mockResolvedValue({ text: "not-json{" });
    const executor = createExecutors().llm;
    const ctx = mockCtx({ llm: { complete } });

    await expect(
      executor.execute(
        {
          id: "n1",
          type: "llm",
          prompt: "get user",
          outputSchema: { type: "object" },
        } as never,
        {},
        ctx as never,
      ),
    ).rejects.toThrow(/非 JSON 文本/);
  });

  it("⑦ host.llm 未绑定 → 抛 hostNotBound（带绑定指引）", async () => {
    const executor = createExecutors().llm;
    const ctx = mockCtx({});
    await expect(
      executor.execute(
        { id: "n1", type: "llm", prompt: "x" } as never,
        {},
        ctx as never,
      ),
    ).rejects.toThrow(/host service "llm" not bound/);
  });

  it("⑧ 数组 items 校验生效（嵌套）", async () => {
    const complete = vi
      .fn()
      .mockResolvedValue({ text: '{"tags":["a",1]}' });
    const executor = createExecutors().llm;
    const ctx = mockCtx({ llm: { complete } });

    await expect(
      executor.execute(
        {
          id: "n1",
          type: "llm",
          prompt: "tags",
          outputSchema: {
            type: "object",
            properties: {
              tags: {
                type: "array",
                items: { type: "string" },
              },
            },
          },
        } as never,
        {},
        ctx as never,
      ),
    ).rejects.toThrow(/outputSchema 校验失败于 \$\.tags\[1\]/);
  });

  it("⑨ type:number 遇整数放行：schema 写 \"number\"，模型返回整数 → 不误拒", async () => {
    const complete = vi
      .fn()
      .mockResolvedValue({ text: '{"score":3}' });
    const executor = createExecutors().llm;
    const ctx = mockCtx({ llm: { complete } });

    const out = await executor.execute(
      {
        id: "n1",
        type: "llm",
        prompt: "get score",
        outputSchema: {
          type: "object",
          properties: { score: { type: "number" } },
        },
      } as never,
      {},
      ctx as never,
    );

    expect(out).toEqual({ result: { score: 3 } });
  });
});

// ================= subagent =================

describe("subagent executor · T6 host binding", () => {
  it("① spawn 返回结构化 result → { result } 透传", async () => {
    const spawn = vi.fn().mockResolvedValue({ result: { answer: 42 } });
    const executor = createExecutors().subagent;
    const ctx = mockCtx({ subagents: { spawn } });

    const out = await executor.execute(
      { id: "n1", type: "subagent", prompt: "analyze" } as never,
      {},
      ctx as never,
    );

    expect(out).toEqual({ result: { answer: 42 } });
    expect(spawn).toHaveBeenCalledWith({
      prompt: "analyze",
      preset: undefined,
    });
  });

  it("② prompt 插值 + preset 透传", async () => {
    const spawn = vi.fn().mockResolvedValue({ result: "done" });
    const executor = createExecutors().subagent;
    const ctx = mockCtx({ subagents: { spawn } });
    ctx.varCtx.set("start", { file: "report.csv" });

    await executor.execute(
      {
        id: "n1",
        type: "subagent",
        prompt: "Review {{#start.file}}",
        preset: "reviewer",
      } as never,
      {},
      ctx as never,
    );

    expect(spawn).toHaveBeenCalledWith({
      prompt: "Review report.csv",
      preset: "reviewer",
    });
  });

  it("③ host.subagents 未绑定 → 抛 hostNotBound", async () => {
    const executor = createExecutors().subagent;
    const ctx = mockCtx({});
    await expect(
      executor.execute(
        { id: "n1", type: "subagent", prompt: "x" } as never,
        {},
        ctx as never,
      ),
    ).rejects.toThrow(/host service "subagents" not bound/);
  });
});

// ================= plugin_tool =================

describe("plugin_tool executor · T6 host binding", () => {
  it("① invoke(toolName, {...inputs, action?}) → 原样输出透传", async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true, data: [1, 2] });
    const executor = createExecutors().plugin_tool;
    const ctx = mockCtx({
      tools: { invoke, has: () => true },
    });

    const out = await executor.execute(
      {
        id: "n1",
        type: "plugin_tool",
        toolName: "tool-fs",
        action: "read",
      } as never,
      { path: "/tmp/a.txt", verbose: true },
      ctx as never,
    );

    // 原样输出（不包装 { result }）
    expect(out).toEqual({ ok: true, data: [1, 2] });
    // args = { ...inputs, action }，action 以 node.action 权威
    expect(invoke).toHaveBeenCalledWith("tool-fs", {
      path: "/tmp/a.txt",
      verbose: true,
      action: "read",
    });
  });

  it("② node.action 权威覆盖 inputs.action", async () => {
    const invoke = vi.fn().mockResolvedValue({ done: true });
    const executor = createExecutors().plugin_tool;
    const ctx = mockCtx({ tools: { invoke } });

    await executor.execute(
      {
        id: "n1",
        type: "plugin_tool",
        toolName: "tool-git",
        action: "run",
      } as never,
      { action: "list" },
      ctx as never,
    );

    expect(invoke).toHaveBeenCalledWith("tool-git", { action: "run" });
  });

  it("③ tools.has 前置检查：工具不存在 → 抛明确错误", async () => {
    const invoke = vi.fn();
    const executor = createExecutors().plugin_tool;
    const ctx = mockCtx({
      tools: { invoke, has: () => false },
    });

    await expect(
      executor.execute(
        {
          id: "n1",
          type: "plugin_tool",
          toolName: "ghost-tool",
        } as never,
        {},
        ctx as never,
      ),
    ).rejects.toThrow(/tool "ghost-tool" not found/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("④ 无 has 通道：invoke 拒绝（工具不存在实现方自行 reject）→ 错误传播", async () => {
    const invoke = vi
      .fn()
      .mockRejectedValue(new Error("tool-x: does not exist"));
    const executor = createExecutors().plugin_tool;
    const ctx = mockCtx({ tools: { invoke } });

    await expect(
      executor.execute(
        { id: "n1", type: "plugin_tool", toolName: "tool-x" } as never,
        {},
        ctx as never,
      ),
    ).rejects.toThrow(/does not exist/);
  });

  it("⑤ host.tools 未绑定 → 抛 hostNotBound", async () => {
    const executor = createExecutors().plugin_tool;
    const ctx = mockCtx({});
    await expect(
      executor.execute(
        { id: "n1", type: "plugin_tool", toolName: "x" } as never,
        {},
        ctx as never,
      ),
    ).rejects.toThrow(/host service "tools" not bound/);
  });
});

// ================= human =================

describe("human executor · T6 host binding（三路径）", () => {
  it("① approved：askUser 返回 {decision:'approved'} → 节点输出含 decision", async () => {
    const askUser = vi.fn().mockResolvedValue({ decision: "approved" });
    const executor = createExecutors().human;
    const ctx = mockCtx({ askUser });
    ctx.varCtx.set("start", { user: "Alice" });

    const out = await executor.execute(
      { id: "n1", type: "human", prompt: "Confirm {{#start.user}}?" } as never,
      {},
      ctx as never,
    );

    expect(out.decision).toBe("approved");
    // prompt 插值后传给 askUser，inputs 为深拷贝快照
    // inputs={} 源自 inputs 参数 {} → structuredClone({}) → {}
    expect(askUser).toHaveBeenCalledWith({
      prompt: "Confirm Alice?",
      inputs: {},
    });
  });

  it("①b approved + inputs 回填：用户输入值合并进节点输出（下游可引用）", async () => {
    const askUser = vi
      .fn()
      .mockResolvedValue({ decision: "approved", inputs: { reason: "LGTM" } });
    const executor = createExecutors().human;
    const ctx = mockCtx({ askUser });

    const out = await executor.execute(
      { id: "n1", type: "human", prompt: "Approve?" } as never,
      { amount: 100 },
      ctx as never,
    );

    expect(out.decision).toBe("approved");
    expect(out.reason).toBe("LGTM");
    expect(out.inputs).toEqual({ reason: "LGTM" });
    // inputs 快照（含变量占位引用解析前的原始值）传给 askUser
    expect(askUser).toHaveBeenCalledWith({
      prompt: "Approve?",
      inputs: { amount: 100 },
    });
  });

  it("② rejected：decision='rejected' → 节点抛错（failed 语义）", async () => {
    const askUser = vi.fn().mockResolvedValue({ decision: "rejected" });
    const executor = createExecutors().human;
    const ctx = mockCtx({ askUser });

    await expect(
      executor.execute(
        { id: "n1", type: "human", prompt: "Approve?" } as never,
        {},
        ctx as never,
      ),
    ).rejects.toThrow(/rejected/);
  });

  it("③ timeoutMs + onTimeout=proceed：askUser 悬挂超时 → 以 {decision:'proceed'} 继续", async () => {
    // askUser 永不 resolve（悬挂审批）
    const askUser = vi.fn().mockImplementation(() => new Promise(() => {}));
    const executor = createExecutors().human;
    const ctx = mockCtx({ askUser });

    const out = await executor.execute(
      {
        id: "n1",
        type: "human",
        prompt: "Approve?",
        timeoutMs: 30,
        onTimeout: "proceed",
      } as never,
      {},
      ctx as never,
    );

    expect(out.decision).toBe("proceed");
  });

  it("③b timeoutMs + onTimeout=abort（默认）：超时 → 抛超时错误", async () => {
    const askUser = vi.fn().mockImplementation(() => new Promise(() => {}));
    const executor = createExecutors().human;
    const ctx = mockCtx({ askUser });

    await expect(
      executor.execute(
        {
          id: "n1",
          type: "human",
          prompt: "Approve?",
          timeoutMs: 30,
          onTimeout: "abort",
        } as never,
        {},
        ctx as never,
      ),
    ).rejects.toThrow(/timed out after 30ms/);
  });

  it("④ ctx.signal abort（run stop/熔断）→ 立即拒绝，human 不悬挂", async () => {
    const askUser = vi.fn().mockImplementation(() => new Promise(() => {}));
    const executor = createExecutors().human;
    const ac = new AbortController();
    const ctx = {
      runId: "run-1",
      nodeId: "n1",
      signal: ac.signal,
      log: vi.fn(),
      varCtx: new VariableContext(),
      host: { askUser },
    };

    const runPromise = executor.execute(
      { id: "n1", type: "human", prompt: "Approve?" } as never,
      {},
      ctx as never,
    );
    ac.abort();

    await expect(runPromise).rejects.toThrow(/aborted by run signal/);
  });

  it("⑤ host.askUser 未绑定 → 抛 hostNotBound", async () => {
    const executor = createExecutors().human;
    const ctx = mockCtx({});
    await expect(
      executor.execute(
        { id: "n1", type: "human", prompt: "x" } as never,
        {},
        ctx as never,
      ),
    ).rejects.toThrow(/host service "askUser" not bound/);
  });

  it("⑥ timer 泄漏回归：signal abort 后 pending setTimeout 被清理，不钉住事件循环", async () => {
    vi.useFakeTimers();
    try {
      // askUser 永不 settle，timeoutMs 设很大（不会触发），signal abort 赢出 race
      const askUser = vi.fn().mockImplementation(() => new Promise(() => {}));
      const executor = createExecutors().human;
      const ac = new AbortController();
      const ctx = {
        runId: "run-1",
        nodeId: "n1",
        signal: ac.signal,
        log: vi.fn(),
        varCtx: new VariableContext(),
        host: { askUser },
      };

      const runPromise = executor.execute(
        {
          id: "n1",
          type: "human",
          prompt: "Approve?",
          timeoutMs: 50_000,
        } as never,
        {},
        ctx as never,
      );
      ac.abort();

      await expect(runPromise).rejects.toThrow(/aborted by run signal/);
      // 断言：pending 定时器已清理，不再占用事件循环
      // vitest 4.x getTimerCount 返回当前未执行的定时器数
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("⑦ decision 权威：用户提交名为 decision 的审批字段不覆盖协议字段", async () => {
    // askUser 返回 inputs 含 decision 字段，但协议字段应保持权威
    const askUser = vi
      .fn()
      .mockResolvedValue({ decision: "approved", inputs: { decision: "user-forged", note: "ok" } });
    const executor = createExecutors().human;
    const ctx = mockCtx({ askUser });

    const out = await executor.execute(
      { id: "n1", type: "human", prompt: "Approve?" } as never,
      {},
      ctx as never,
    );

    // 协议字段保持权威
    expect(out.decision).toBe("approved");
    // 用户 inputs 仍正确合并
    expect(out.note).toBe("ok");
    // 用户 inputs 的整体也保留
    expect(out.inputs).toEqual({ decision: "user-forged", note: "ok" });
  });
});

// ================= Engine 注入贯通 =================

describe("Engine 构造 host 注入 → ctx.host 贯通", () => {
  it("① 四类服务经 options.host 注入，整条工作流跑通（start→llm→human→plugin_tool→subagent→end）", async () => {
    const complete = vi.fn().mockResolvedValue({ text: '{"topic":"AI"}' });
    const askUser = vi.fn().mockResolvedValue({
      decision: "approved",
      inputs: { note: "ok" },
    });
    const spawn = vi.fn().mockResolvedValue({ result: { summary: "done" } });
    const invoke = vi.fn().mockResolvedValue({ path: "/tmp/a.txt" });

    const engine = new Engine(createExecutors(), {
      maxParallelNodes: 4,
      host: {
        llm: { complete },
        askUser,
        subagents: { spawn },
        tools: { invoke, has: () => true },
      },
    });

    const workflow = dsl(
      [
        { id: "start", type: "start" },
        {
          id: "gen",
          type: "llm",
          prompt: "summarize {{#start.topic}}",
          outputSchema: { type: "object" },
        },
        { id: "approve", type: "human", prompt: "OK?" },
        {
          id: "write",
          type: "plugin_tool",
          toolName: "tool-fs",
          action: "write",
        },
        { id: "research", type: "subagent", prompt: "deep dive", preset: "researcher" },
        { id: "end", type: "end" },
      ],
      [
        { id: "e1", source: "start", target: "gen" },
        { id: "e2", source: "gen", target: "approve" },
        { id: "e3", source: "approve", target: "write" },
        { id: "e4", source: "write", target: "research" },
        { id: "e5", source: "research", target: "end" },
      ],
    );

    const result = await engine.run(workflow, { topic: "dsh" });

    expect(result.status).toBe("success");
    // llm：prompt 插值命中 varCtx（start 输出）
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "summarize dsh" }),
    );
    expect(result.outputs.gen).toEqual({ result: { topic: "AI" } });
    // human：decision + 回填 inputs
    expect(result.outputs.approve.decision).toBe("approved");
    expect(result.outputs.approve.note).toBe("ok");
    // plugin_tool：原样输出（含 inputs 透传 + action）
    expect(result.outputs.write).toEqual({ path: "/tmp/a.txt" });
    // write 节点无 inputs，args 仅含 action
    expect(invoke).toHaveBeenCalledWith("tool-fs", {
      action: "write",
    });
    // subagent
    expect(result.outputs.research).toEqual({ result: { summary: "done" } });
    expect(spawn).toHaveBeenCalledWith({
      prompt: "deep dive",
      preset: "researcher",
    });
  });

  it("② host 缺省未绑定：human 节点执行 → 节点 failed，错误含绑定指引", async () => {
    const engine = new Engine(createExecutors());

    const workflow = dsl(
      [
        { id: "start", type: "start" },
        { id: "approve", type: "human", prompt: "OK?" },
      ],
      [
        { id: "e1", source: "start", target: "approve" },
      ],
    );

    const result = await engine.run(workflow, {});
    expect(result.status).toBe("failed");
    expect(result.nodeStates.approve.status).toBe("failed");
    expect(result.nodeStates.approve.error).toContain(
      'host service "askUser" not bound',
    );
  });

  it("③ host 仅绑定部分服务：llm 可用、human 缺失各自独立", async () => {
    const engine = new Engine(createExecutors(), {
      host: { llm: { complete: async () => ({ text: "hi" }) } },
    });

    const both = dsl(
      [
        { id: "start", type: "start" },
        { id: "gen", type: "llm", prompt: "x" },
        { id: "approve", type: "human", prompt: "y" },
      ],
      [
        { id: "e1", source: "start", target: "gen" },
        { id: "e2", source: "gen", target: "approve" },
      ],
    );

    const result = await engine.run(both, {});
    expect(result.status).toBe("failed");
    expect(result.nodeStates.gen.status).toBe("success");
    expect(result.outputs.gen).toEqual({ result: "hi" });
    expect(result.nodeStates.approve.status).toBe("failed");
    expect(result.nodeStates.approve.error).toContain("askUser");
  });
});