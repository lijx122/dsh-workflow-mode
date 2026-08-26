import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { WorkflowEngine, createExecutors } from "@dsh-workflow/engine";
import type { WorkflowDSL, ValidateError } from "@dsh-workflow/schema";
import { WorkflowController, WorkflowFileWatcher } from "../src/index.js";

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  intervalMs = 50,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitUntil timed out after ${timeoutMs}ms`);
}

describe("WorkflowFileWatcher & Hot-Reload", () => {
  let tmpDir: string;
  let engine: WorkflowEngine;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(
      path.join(process.env.TEMP || os.tmpdir(), "dsh-workflow-watcher-test-"),
    );
    engine = new WorkflowEngine(createExecutors());
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("1. 写入合法 JSON → onValid 触发且携带解析后 DSL", async () => {
    const validEvents: Array<{ file: string; dsl: WorkflowDSL }> = [];
    const invalidEvents: Array<{ file: string; errors: ValidateError[] }> = [];

    const watcher = new WorkflowFileWatcher({
      workflowsDir: tmpDir,
      debounceMs: 50,
      onValid: (file, dsl) => {
        validEvents.push({ file, dsl });
      },
      onInvalid: (file, errors) => {
        invalidEvents.push({ file, errors });
      },
    });

    watcher.start();

    const validDsl: WorkflowDSL = {
      version: "dsh.workflow.v1",
      name: "flow-valid",
      nodes: [{ id: "start", type: "start" }],
      edges: [],
    };

    fs.writeFileSync(
      path.join(tmpDir, "flow1.json"),
      JSON.stringify(validDsl, null, 2),
      "utf-8",
    );

    await waitUntil(() => validEvents.length > 0);

    expect(validEvents).toHaveLength(1);
    expect(validEvents[0].file).toBe("flow1.json");
    expect(validEvents[0].dsl.name).toBe("flow-valid");
    expect(validEvents[0].dsl.nodes).toHaveLength(1);
    expect(invalidEvents).toHaveLength(0);

    await watcher.stop();
  });

  it("2. 写入非法 JSON → onInvalid 触发且 errors 含 SCHEMA", async () => {
    const validEvents: Array<{ file: string; dsl: WorkflowDSL }> = [];
    const invalidEvents: Array<{ file: string; errors: ValidateError[] }> = [];

    const watcher = new WorkflowFileWatcher({
      workflowsDir: tmpDir,
      debounceMs: 50,
      onValid: (file, dsl) => {
        validEvents.push({ file, dsl });
      },
      onInvalid: (file, errors) => {
        invalidEvents.push({ file, errors });
      },
    });

    watcher.start();

    // 写入语法错误的非法 JSON
    fs.writeFileSync(
      path.join(tmpDir, "broken-syntax.json"),
      "{ invalid json syntax",
      "utf-8",
    );

    await waitUntil(() => invalidEvents.length > 0);

    expect(invalidEvents).toHaveLength(1);
    expect(invalidEvents[0].file).toBe("broken-syntax.json");
    expect(invalidEvents[0].errors.length).toBeGreaterThan(0);
    expect(invalidEvents[0].errors.some((e) => e.code === "SCHEMA")).toBe(true);
    expect(validEvents).toHaveLength(0);

    // 再次写入不符合 schema 的非法 DSL（缺失必要字段 version / nodes / edges）
    const schemaInvalidDsl = {
      invalidProperty: true,
    };
    fs.writeFileSync(
      path.join(tmpDir, "broken-schema.json"),
      JSON.stringify(schemaInvalidDsl),
      "utf-8",
    );

    await waitUntil(() => invalidEvents.length > 1);
    expect(invalidEvents).toHaveLength(2);
    expect(invalidEvents[1].file).toBe("broken-schema.json");
    expect(invalidEvents[1].errors.some((e) => e.code === "SCHEMA")).toBe(true);

    await watcher.stop();
  });

  it("3. 同内容重复写两次 → onValid 只触发一次（哈希去重）", async () => {
    const validEvents: Array<{ file: string; dsl: WorkflowDSL }> = [];
    const invalidEvents: Array<{ file: string; errors: ValidateError[] }> = [];

    const watcher = new WorkflowFileWatcher({
      workflowsDir: tmpDir,
      debounceMs: 50,
      onValid: (file, dsl) => {
        validEvents.push({ file, dsl });
      },
      onInvalid: (file, errors) => {
        invalidEvents.push({ file, errors });
      },
    });

    watcher.start();

    const dslContent = JSON.stringify(
      {
        version: "dsh.workflow.v1",
        name: "duplicate-test",
        nodes: [{ id: "start", type: "start" }],
        edges: [],
      },
      null,
      2,
    );

    const filePath = path.join(tmpDir, "dedup.json");

    // 第一次写入
    fs.writeFileSync(filePath, dslContent, "utf-8");
    await waitUntil(() => validEvents.length === 1);
    expect(validEvents).toHaveLength(1);

    // 写入完全相同的文本内容
    fs.writeFileSync(filePath, dslContent, "utf-8");

    // 等待 200ms
    await new Promise((r) => setTimeout(r, 200));

    // onValid 仍为 1，未重复触发
    expect(validEvents).toHaveLength(1);

    // 内容变更后再次写入
    const updatedContent = JSON.stringify(
      {
        version: "dsh.workflow.v1",
        name: "duplicate-test-updated",
        nodes: [{ id: "start", type: "start" }],
        edges: [],
      },
      null,
      2,
    );
    fs.writeFileSync(filePath, updatedContent, "utf-8");

    await waitUntil(() => validEvents.length === 2);
    expect(validEvents).toHaveLength(2);
    expect(validEvents[1].dsl.name).toBe("duplicate-test-updated");

    await watcher.stop();
  });

  it("4. controller 开 watcher 后：写入合法文件 → registry version 递增与热更新", async () => {
    const registryChanges: string[] = [];

    const controller = new WorkflowController(engine, {
      workflowsDir: tmpDir,
      watcher: true,
      debounceMs: 50,
      onRegistryChange: (file) => {
        registryChanges.push(file);
      },
    });

    const flowPath = path.join(tmpDir, "calc.json");
    const dslV1: WorkflowDSL = {
      version: "dsh.workflow.v1",
      name: "calc-flow",
      nodes: [
        { id: "start", type: "start" },
        {
          id: "step1",
          type: "code",
          code: "return { val: 100 };",
        },
      ],
      edges: [{ id: "e1", source: "start", target: "step1" }],
    };

    // 写入 v1
    fs.writeFileSync(flowPath, JSON.stringify(dslV1, null, 2), "utf-8");

    await waitUntil(
      () => (controller.registry.get("calc.json")?.version ?? 0) >= 1,
    );

    const entryV1 = controller.registry.get("calc.json");
    expect(entryV1).toBeDefined();
    expect(entryV1?.version).toBe(1);
    expect(entryV1?.dsl.name).toBe("calc-flow");
    expect(registryChanges).toContain("calc.json");

    // 执行 run 验证取自 registry 并成功执行
    const { runId: runId1 } = await controller.run("calc.json");
    const res1 = await controller.waitFor(runId1);
    expect(res1.status).toBe("success");
    expect(res1.outputs.step1).toEqual({ val: 100 });

    // 写入 v2
    const dslV2: WorkflowDSL = {
      version: "dsh.workflow.v1",
      name: "calc-flow-v2",
      nodes: [
        { id: "start", type: "start" },
        {
          id: "step1",
          type: "code",
          code: "return { val: 200 };",
        },
      ],
      edges: [{ id: "e1", source: "start", target: "step1" }],
    };

    fs.writeFileSync(flowPath, JSON.stringify(dslV2, null, 2), "utf-8");

    await waitUntil(
      () => (controller.registry.get("calc.json")?.version ?? 0) >= 2,
    );

    const entryV2 = controller.registry.get("calc.json");
    expect(entryV2?.version).toBe(2);
    expect(entryV2?.dsl.name).toBe("calc-flow-v2");

    // 执行 run 验证拿到的是热重载后的最新 v2 DSL
    const { runId: runId2 } = await controller.run("calc.json");
    const res2 = await controller.waitFor(runId2);
    expect(res2.status).toBe("success");
    expect(res2.outputs.step1).toEqual({ val: 200 });

    // 写入损坏文件 -> 触发 onInvalid -> registry 保持 last-good v2
    fs.writeFileSync(flowPath, "{ broken json corrupt", "utf-8");
    await new Promise((r) => setTimeout(r, 200));

    // registry 应仍保持 v2
    const entryAfterBroken = controller.registry.get("calc.json");
    expect(entryAfterBroken?.version).toBe(2);
    expect(entryAfterBroken?.dsl.name).toBe("calc-flow-v2");

    await controller.stopWatcher();
  });

  it("7. 写入 n8n 原生工作流 JSON → 自动识别并通过 onValid 触发", async () => {
    const validEvents: Array<{ file: string; dsl: any }> = [];

    const watcher = new WorkflowFileWatcher({
      workflowsDir: tmpDir,
      debounceMs: 50,
      onValid: (file, dsl) => {
        validEvents.push({ file, dsl });
      },
      onInvalid: () => {},
    });

    watcher.start();

    const n8nWorkflowJson = {
      name: "n8n-test-flow",
      nodes: [
        {
          id: "node-1",
          name: "Schedule Trigger",
          type: "n8n-nodes-base.scheduleTrigger",
          position: [240, 300],
        },
      ],
      connections: {
        "Schedule Trigger": {
          main: [],
        },
      },
      settings: { executionOrder: "v1" },
    };

    fs.writeFileSync(
      path.join(tmpDir, "n8n-flow.json"),
      JSON.stringify(n8nWorkflowJson, null, 2),
      "utf-8",
    );

    await waitUntil(() => validEvents.length > 0);

    expect(validEvents).toHaveLength(1);
    expect(validEvents[0].file).toBe("n8n-flow.json");
    expect(validEvents[0].dsl.name).toBe("n8n-test-flow");
    expect(validEvents[0].dsl.nodes).toHaveLength(1);

    await watcher.stop();
  });
});
