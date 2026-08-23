import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { WorkflowEngine, createExecutors } from "@dsh-workflow/engine";
import { WorkflowController, RetentionCleaner } from "../src/index.js";

describe("RetentionCleaner & Controller Retention", () => {
  let tmpDir: string;
  let runsBaseDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "dsh-workflow-retention-test-"),
    );
    runsBaseDir = path.join(tmpDir, "runs");
    fs.mkdirSync(runsBaseDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("1. 构造 105 个历史 run 目录 → clean 后剩 100 且被删的是最旧的 5 个", async () => {
    const wfName = "demo_flow";
    const wfDir = path.join(runsBaseDir, wfName);
    fs.mkdirSync(wfDir, { recursive: true });

    const now = Date.now();
    const baseTime = now - 200 * 1000; // 200 秒前，完全在默认 7 天内
    // 创建 105 个 run，startedAt 递增：run-000 (最旧, startedAt=baseTime) 到 run-104 (最新, startedAt=baseTime+104*1000)
    for (let i = 0; i < 105; i++) {
      const runId = `run-${i.toString().padStart(3, "0")}`;
      const runDir = path.join(wfDir, runId);
      fs.mkdirSync(runDir, { recursive: true });
      const runJson = {
        runId,
        workflowName: "Demo Flow",
        status: "success",
        startedAt: baseTime + i * 1000,
        finishedAt: baseTime + i * 1000 + 500,
        inputs: {},
        nodeStates: {},
      };
      fs.writeFileSync(
        path.join(runDir, "run.json"),
        JSON.stringify(runJson, null, 2),
        "utf-8",
      );
    }

    const cleaner = new RetentionCleaner(runsBaseDir, {
      maxRuns: 100,
      maxAgeDays: 7,
    });
    const res = await cleaner.clean();

    expect(res.removed).toBe(5);

    const remainingDirs = fs
      .readdirSync(wfDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();

    expect(remainingDirs.length).toBe(100);

    // 最旧的 5 个 (run-000 到 run-004) 必须已被删除
    for (let i = 0; i < 5; i++) {
      const deletedId = `run-${i.toString().padStart(3, "0")}`;
      expect(remainingDirs).not.toContain(deletedId);
    }

    // 最新的 100 个 (run-005 到 run-104) 必须完整保留
    for (let i = 5; i < 105; i++) {
      const keptId = `run-${i.toString().padStart(3, "0")}`;
      expect(remainingDirs).toContain(keptId);
    }
  });

  it("2. maxAgeDays=0.01（约 15 分钟）+ 一个 startedAt 为 2 小时前的 run → 被清除", async () => {
    const wfName = "age_flow";
    const wfDir = path.join(runsBaseDir, wfName);
    fs.mkdirSync(wfDir, { recursive: true });

    const now = Date.now();
    // run-old: 2 小时前 (7200 秒前)
    const oldRunId = "run-old-2h";
    const oldRunDir = path.join(wfDir, oldRunId);
    fs.mkdirSync(oldRunDir, { recursive: true });
    fs.writeFileSync(
      path.join(oldRunDir, "run.json"),
      JSON.stringify({
        runId: oldRunId,
        workflowName: "Age Flow",
        status: "success",
        startedAt: now - 2 * 60 * 60 * 1000,
      }),
      "utf-8",
    );

    // run-new: 1 分钟前
    const newRunId = "run-new-1m";
    const newRunDir = path.join(wfDir, newRunId);
    fs.mkdirSync(newRunDir, { recursive: true });
    fs.writeFileSync(
      path.join(newRunDir, "run.json"),
      JSON.stringify({
        runId: newRunId,
        workflowName: "Age Flow",
        status: "success",
        startedAt: now - 60 * 1000,
      }),
      "utf-8",
    );

    const cleaner = new RetentionCleaner(runsBaseDir, {
      maxRuns: 100,
      maxAgeDays: 0.01, // 约 14.4 分钟
    });
    const res = await cleaner.clean();

    expect(res.removed).toBe(1);
    expect(fs.existsSync(oldRunDir)).toBe(false);
    expect(fs.existsSync(newRunDir)).toBe(true);
  });

  it("3. clean 对损坏 run.json 的容错（跳过不抛）", async () => {
    const wfName = "corrupt_flow";
    const wfDir = path.join(runsBaseDir, wfName);
    fs.mkdirSync(wfDir, { recursive: true });

    // 损坏目录 1: run.json 为语法错误的非 JSON
    const badJsonDir = path.join(wfDir, "run-bad-json");
    fs.mkdirSync(badJsonDir, { recursive: true });
    fs.writeFileSync(
      path.join(badJsonDir, "run.json"),
      "{ invalid json syntax ...",
      "utf-8",
    );

    // 损坏目录 2: run.json 缺少 startedAt
    const noStartedDir = path.join(wfDir, "run-no-started");
    fs.mkdirSync(noStartedDir, { recursive: true });
    fs.writeFileSync(
      path.join(noStartedDir, "run.json"),
      JSON.stringify({ runId: "no-started" }),
      "utf-8",
    );

    // 损坏目录 3: 空目录无 run.json
    const emptyDir = path.join(wfDir, "run-empty");
    fs.mkdirSync(emptyDir, { recursive: true });

    // 正常目录
    const goodDir = path.join(wfDir, "run-good");
    fs.mkdirSync(goodDir, { recursive: true });
    fs.writeFileSync(
      path.join(goodDir, "run.json"),
      JSON.stringify({
        runId: "run-good",
        workflowName: "Corrupt Flow",
        status: "success",
        startedAt: Date.now(),
      }),
      "utf-8",
    );

    const cleaner = new RetentionCleaner(runsBaseDir, {
      maxRuns: 100,
      maxAgeDays: 7,
    });

    // 保证 clean() 不抛异常
    await expect(cleaner.clean()).resolves.toEqual({ removed: 0 });

    // 验证所有目录依旧安全存在未被误删
    expect(fs.existsSync(badJsonDir)).toBe(true);
    expect(fs.existsSync(noStartedDir)).toBe(true);
    expect(fs.existsSync(emptyDir)).toBe(true);
    expect(fs.existsSync(goodDir)).toBe(true);
  });

  it("4. controller 集成：执行 run 结束后触发惰性清理", async () => {
    const engine = new WorkflowEngine(createExecutors());
    const controller = new WorkflowController(engine, {
      workflowsDir: tmpDir,
      retention: {
        maxRuns: 2,
        maxAgeDays: 7,
      },
    });

    const dsl = {
      version: "dsh.workflow.v1",
      name: "retention-flow",
      nodes: [
        { id: "start", type: "start" },
        { id: "step1", type: "code", code: "return { ok: true };" },
      ],
      edges: [{ id: "e1", source: "start", target: "step1" }],
    };
    fs.writeFileSync(
      path.join(tmpDir, "flow.json"),
      JSON.stringify(dsl),
      "utf-8",
    );

    // 连续执行 3 次
    const { runId: r1 } = await controller.run("flow.json");
    await controller.waitFor(r1);

    await new Promise((r) => setTimeout(r, 20));
    const { runId: r2 } = await controller.run("flow.json");
    await controller.waitFor(r2);

    await new Promise((r) => setTimeout(r, 20));
    const { runId: r3 } = await controller.run("flow.json");
    await controller.waitFor(r3);

    // 等待异步清理微任务执行
    await new Promise((r) => setTimeout(r, 50));

    const wfRunDir = path.join(tmpDir, "runs", "retention-flow");
    const remainingRuns = fs
      .readdirSync(wfRunDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);

    // 配置 maxRuns = 2，因此保留最新的 r3 和 r2，r1 被清理
    expect(remainingRuns.length).toBe(2);
    expect(remainingRuns).toContain(r3);
    expect(remainingRuns).toContain(r2);
    expect(remainingRuns).not.toContain(r1);
  });

  it("5. runsBaseDir 不存在时 clean() 返回 removed: 0 且不抛出异常", async () => {
    const notExistDir = path.join(tmpDir, "non_existent_runs");
    const cleaner = new RetentionCleaner(notExistDir);
    const res = await cleaner.clean();
    expect(res).toEqual({ removed: 0 });
  });
});
