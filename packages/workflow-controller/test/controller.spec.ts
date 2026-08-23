import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { WorkflowEngine, createExecutors } from "@dsh-workflow/engine";
import { WorkflowController } from "../src/index.js";

describe("WorkflowController", () => {
  let tmpDir: string;
  let engine: WorkflowEngine;
  let controller: WorkflowController;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-workflow-controller-test-"));
    engine = new WorkflowEngine(createExecutors());
    controller = new WorkflowController(engine, { workflowsDir: tmpDir });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("1. list: 空目录返回 []，非空目录返回 *.json 文件名列表", () => {
    expect(controller.list()).toEqual([]);

    fs.writeFileSync(path.join(tmpDir, "flow-a.json"), "{}", "utf-8");
    fs.writeFileSync(path.join(tmpDir, "flow-b.json"), "{}", "utf-8");
    fs.writeFileSync(path.join(tmpDir, "readme.txt"), "hello", "utf-8");

    expect(controller.list()).toEqual(["flow-a.json", "flow-b.json"]);
  });

  it("2. validate: 合法 DSL 返回 ok: true，非法 DSL 返回 ok: false 带错误", () => {
    const validDsl = {
      version: "dsh.workflow.v1",
      name: "valid-flow",
      nodes: [{ id: "start", type: "start" }],
      edges: [],
    };
    fs.writeFileSync(
      path.join(tmpDir, "valid.json"),
      JSON.stringify(validDsl),
      "utf-8",
    );

    const invalidDsl = {
      version: "dsh.workflow.v1",
      name: "invalid-flow",
      nodes: [{ id: "123bad_id", type: "start" }],
      edges: [],
    };
    fs.writeFileSync(
      path.join(tmpDir, "invalid.json"),
      JSON.stringify(invalidDsl),
      "utf-8",
    );

    const resValid = controller.validate("valid.json");
    expect(resValid.ok).toBe(true);
    expect(resValid.errors).toHaveLength(0);

    const resInvalid = controller.validate("invalid.json");
    expect(resInvalid.ok).toBe(false);
    expect(resInvalid.errors.length).toBeGreaterThan(0);
  });

  it("3. run → status: 真实 engine 执行至终态，status 反映 success 与节点状态", async () => {
    const dsl = {
      version: "dsh.workflow.v1",
      name: "calc-flow",
      nodes: [
        { id: "start", type: "start" },
        {
          id: "step1",
          type: "code",
          code: "return { count: 10 + 20 };",
        },
      ],
      edges: [{ id: "e1", source: "start", target: "step1" }],
    };
    fs.writeFileSync(
      path.join(tmpDir, "calc.json"),
      JSON.stringify(dsl),
      "utf-8",
    );

    const { runId } = await controller.run("calc.json", { initial: 1 });
    expect(runId).toBeDefined();

    const res = await controller.waitFor(runId);
    expect(res.status).toBe("success");
    expect(res.outputs.step1).toEqual({ count: 30 });

    const status = controller.status(runId);
    expect(status).toBeDefined();
    expect(status?.status).toBe("success");
    expect(status?.nodes.find((n) => n.id === "step1")?.status).toBe("success");
  });

  it("4. stop: 运行含长耗时节点的工作流，调用 stop 能够立即停止并置 status=stopped", async () => {
    const dsl = {
      version: "dsh.workflow.v1",
      name: "long-flow",
      nodes: [
        { id: "start", type: "start" },
        {
          id: "step1",
          type: "code",
          code: "let x = 0; while (true) { x++; } return { x };",
          timeoutMs: 10000,
        },
      ],
      edges: [{ id: "e1", source: "start", target: "step1" }],
    };
    fs.writeFileSync(
      path.join(tmpDir, "long.json"),
      JSON.stringify(dsl),
      "utf-8",
    );

    const { runId } = await controller.run("long.json");
    // 稍等微任务启动
    await new Promise((r) => setTimeout(r, 50));

    const stopRes = controller.stop(runId);
    expect(stopRes.stopped).toBe(true);

    const res = await controller.waitFor(runId);
    expect(res.status).toBe("stopped");
  });

  it("5. logs: 执行工作流后，logs 正确读取 events.jsonl 尾部记录与过滤", async () => {
    const dsl = {
      version: "dsh.workflow.v1",
      name: "logged-flow",
      nodes: [
        { id: "start", type: "start" },
        { id: "step1", type: "code", code: "return { a: 1 };" },
        { id: "step2", type: "template", template: "A is {{#step1.a}}" },
      ],
      edges: [
        { id: "e1", source: "start", target: "step1" },
        { id: "e2", source: "step1", target: "step2" },
      ],
    };
    fs.writeFileSync(
      path.join(tmpDir, "logged.json"),
      JSON.stringify(dsl),
      "utf-8",
    );

    const { runId } = await controller.run("logged.json");
    await controller.waitFor(runId);

    const allLogs = controller.logs(runId);
    expect(allLogs.events.length).toBeGreaterThan(0);
    expect(allLogs.events.some((e) => e.type === "run_start")).toBe(true);
    expect(allLogs.events.some((e) => e.type === "run_finish")).toBe(true);

    const tailLogs = controller.logs(runId, { tail: 2 });
    expect(tailLogs.events.length).toBeLessThanOrEqual(2);

    const nodeLogs = controller.logs(runId, { nodeId: "step1" });
    expect(nodeLogs.events.every((e) => e.nodeId === "step1")).toBe(true);
  });

  it("6. history: 多次执行后扫描 runs 目录生成摘要，按 startedAt 倒序排列", async () => {
    const dsl = {
      version: "dsh.workflow.v1",
      name: "hist-flow",
      nodes: [{ id: "start", type: "start" }],
      edges: [],
    };
    fs.writeFileSync(
      path.join(tmpDir, "hist.json"),
      JSON.stringify(dsl),
      "utf-8",
    );

    const { runId: run1 } = await controller.run("hist.json");
    await controller.waitFor(run1);
    await new Promise((r) => setTimeout(r, 20));

    const { runId: run2 } = await controller.run("hist.json");
    await controller.waitFor(run2);

    const history = controller.history();
    expect(history.length).toBe(2);
    expect(history[0].runId).toBe(run2);
    expect(history[1].runId).toBe(run1);

    const limited = controller.history(undefined, 1);
    expect(limited.length).toBe(1);
    expect(limited[0].runId).toBe(run2);
  });

  it("7. test: 单节点干跑直接返回 NodeOutput，且不产生正式 runs 目录", async () => {
    const dsl = {
      version: "dsh.workflow.v1",
      name: "test-flow",
      nodes: [
        { id: "start", type: "start" },
        {
          id: "transform",
          type: "code",
          code: "return { double: inputs.val * 2 };",
          inputs: { val: "0" },
        },
      ],
      edges: [{ id: "e1", source: "start", target: "transform" }],
    };
    fs.writeFileSync(
      path.join(tmpDir, "testflow.json"),
      JSON.stringify(dsl),
      "utf-8",
    );

    const output = await controller.test("testflow.json", "transform", {
      val: "21",
    });
    expect(output).toEqual({ double: 42 });

    // 验证不产生 runs 目录
    const runsBase = path.join(tmpDir, "runs");
    expect(fs.existsSync(runsBase)).toBe(false);
  });

  it("8. reload: 合法文件递增版本号，非法文件保持版本号并返回 errors", () => {
    const validDsl = {
      version: "dsh.workflow.v1",
      name: "re-flow",
      nodes: [{ id: "start", type: "start" }],
      edges: [],
    };
    fs.writeFileSync(
      path.join(tmpDir, "reload.json"),
      JSON.stringify(validDsl),
      "utf-8",
    );

    const r1 = controller.reload("reload.json");
    expect(r1.ok).toBe(true);
    expect(r1.version).toBe(1);

    const r2 = controller.reload("reload.json");
    expect(r2.ok).toBe(true);
    expect(r2.version).toBe(2);

    fs.writeFileSync(
      path.join(tmpDir, "reload.json"),
      JSON.stringify({ version: "bad" }),
      "utf-8",
    );
    const r3 = controller.reload("reload.json");
    expect(r3.ok).toBe(false);
    expect(r3.version).toBe(2);
    expect(r3.errors?.length).toBeGreaterThan(0);
  });

  it("9. human approve: human 节点挂起为 waiting_human，approve 注入决策与 inputs 后放行闭环", async () => {
    const dsl = {
      version: "dsh.workflow.v1",
      name: "approval-flow",
      nodes: [
        { id: "start", type: "start" },
        {
          id: "review",
          type: "human",
          prompt: "Approve deploy for {{#start.env}}?",
        },
        {
          id: "report",
          type: "template",
          template: "Decision: {{#review.decision}}, Comment: {{#review.comment}}",
        },
      ],
      edges: [
        { id: "e1", source: "start", target: "review" },
        { id: "e2", source: "review", target: "report" },
      ],
    };
    fs.writeFileSync(
      path.join(tmpDir, "human.json"),
      JSON.stringify(dsl),
      "utf-8",
    );

    const { runId } = await controller.run("human.json", { env: "prod" });

    // 等待进入 waiting_human
    let waiting = false;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 25));
      const s = controller.status(runId);
      if (s?.status === "waiting_human" || s?.nodes.find((n) => n.id === "review")?.status === "waiting_human") {
        waiting = true;
        break;
      }
    }
    expect(waiting).toBe(true);

    // 验证 resume(runId)
    const resumeCheck = controller.resume(runId);
    expect(resumeCheck.resumed).toBe(true);

    // 提交审批
    const approveRes = controller.approve(runId, "review", "approved", {
      comment: "LGTM to production",
    });
    expect(approveRes).toEqual({
      nodeId: "review",
      decision: "approved",
      resumed: true,
    });

    const result = await controller.waitFor(runId);
    expect(result.status).toBe("success");
    expect(result.outputs.review.decision).toBe("approved");
    expect(result.outputs.review.comment).toBe("LGTM to production");
    expect(result.outputs.report.result).toBe(
      "Decision: approved, Comment: LGTM to production",
    );
  });
});
