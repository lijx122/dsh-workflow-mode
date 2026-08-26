import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { WorkflowEngine, createExecutors, type HostServices, type JsonValue } from "@dsh-workflow/engine";
import { WorkflowController } from "../src/index.js";

describe("E2E WorkflowController Integration Tests", () => {
  let tmpDir: string;
  const examplesDir = path.resolve(__dirname, "../../../examples/workflows");

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-workflow-e2e-"));
    // Copy example workflows into controller workflows directory
    fs.copyFileSync(
      path.join(examplesDir, "ci-deploy.json"),
      path.join(tmpDir, "ci-deploy.json"),
    );
    fs.copyFileSync(
      path.join(examplesDir, "batch-report.json"),
      path.join(tmpDir, "batch-report.json"),
    );
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("1. ci-deploy: HIGH 风险路径走 human 断点审批 → deploy 执行 → run.json 终态 success", async () => {
    let bashInvoked = false;
    let sshInvoked = false;

    const mockHost: HostServices = {
      tools: {
        has: () => true,
        invoke: async (toolName: string, args: Record<string, JsonValue>) => {
          if (toolName === "tool-bash") {
            bashInvoked = true;
            return {
              stdout: "+++ dangerous_exec_call()\n--- safe_call()\n+ DROP TABLE users;",
              stderr: "",
              exitCode: 0,
            };
          }
          if (toolName === "dsh-ssh") {
            sshInvoked = true;
            return {
              success: true,
              exitCode: 0,
              stdout: "deployed to " + String(args.alias ?? "default"),
            };
          }
          return {};
        },
      },
      llm: {
        complete: async () => ({
          text: JSON.stringify({ riskLevel: "HIGH" }),
        }),
      },
    };

    const engine = new WorkflowEngine(createExecutors(), { host: mockHost });
    const controller = new WorkflowController(engine, { workflowsDir: tmpDir });

    const val = controller.validate("ci-deploy.json");
    expect(val.ok).toBe(true);

    const { runId } = await controller.run("ci-deploy.json", {
      repo_url: "https://github.com/my-org/core-service.git",
      env: "production",
    });
    expect(runId).toBeDefined();

    // 等待引擎进入 waiting_human 状态
    await new Promise<void>((resolve, reject) => {
      const start = Date.now();
      const interval = setInterval(() => {
        const curStatus = controller.status(runId);
        if (curStatus?.status === "waiting_human" || curStatus?.nodeStates?.confirm?.status === "waiting_human") {
          clearInterval(interval);
          resolve();
        } else if (Date.now() - start > 5000) {
          clearInterval(interval);
          reject(new Error("Timeout waiting for human approval state"));
        }
      }, 50);
    });

    const waitingStatus = controller.status(runId);
    expect(waitingStatus?.status).toBe("waiting_human");
    expect(waitingStatus?.nodeStates?.confirm?.status).toBe("waiting_human");
    expect(bashInvoked).toBe(true);
    expect(sshInvoked).toBe(false); // deploy 还未执行

    // 人工提交审批批准（带回填参数）
    const approveResult = controller.approve(runId, "confirm", "approved", {
      approved: true,
      reviewer: "security-lead",
    });
    expect(approveResult.resumed).toBe(true);

    // 等待全流程完成
    const res = await controller.waitFor(runId);
    expect(res.status).toBe("success");
    expect(sshInvoked).toBe(true);

    // 断言节点终态
    expect(res.nodeStates.start?.status).toBe("success");
    expect(res.nodeStates.git_clone?.status).toBe("success");
    expect(res.nodeStates.extract?.status).toBe("success");
    expect(res.nodeStates.audit?.status).toBe("success");
    expect(res.nodeStates.gate?.status).toBe("success");
    expect(res.nodeStates.confirm?.status).toBe("success");
    expect(res.nodeStates.deploy?.status).toBe("success");
    expect(res.nodeStates.end?.status).toBe("success");

    // 检查 run.json 磁盘持久化终态
    const runJsonPath = path.join(
      tmpDir,
      "runs",
      "ci-deploy",
      runId,
      "run.json",
    );
    expect(fs.existsSync(runJsonPath)).toBe(true);
    const persisted = JSON.parse(fs.readFileSync(runJsonPath, "utf-8"));
    expect(persisted.status).toBe("success");
    expect(persisted.nodeStates.confirm.status).toBe("success");
    expect(persisted.nodeStates.deploy.status).toBe("success");
  });

  it("2. ci-deploy: LOW 风险路径不经 human 直达 deploy（DPE 验证 confirm 节点 status=skipped）", async () => {
    let sshInvoked = false;

    const mockHost: HostServices = {
      tools: {
        has: () => true,
        invoke: async (toolName: string, args: Record<string, JsonValue>) => {
          if (toolName === "tool-bash") {
            return {
              stdout: "+++ console.log('hello world')\n--- console.log('old')",
              stderr: "",
              exitCode: 0,
            };
          }
          if (toolName === "dsh-ssh") {
            sshInvoked = true;
            return {
              success: true,
              exitCode: 0,
              stdout: "deployed to " + String(args.alias ?? "default"),
            };
          }
          return {};
        },
      },
      llm: {
        complete: async () => ({
          text: JSON.stringify({ riskLevel: "LOW" }),
        }),
      },
    };

    const engine = new WorkflowEngine(createExecutors(), { host: mockHost });
    const controller = new WorkflowController(engine, { workflowsDir: tmpDir });

    const { runId } = await controller.run("ci-deploy.json", {
      repo_url: "https://github.com/my-org/frontend.git",
      env: "staging",
    });

    const res = await controller.waitFor(runId);
    expect(res.status).toBe("success");
    expect(sshInvoked).toBe(true);

    // DPE 语义验证：gate condition 为 false，branch=false 激活 deploy，branch=true 跳过 confirm
    expect(res.nodeStates.confirm?.status).toBe("skipped");
    expect(res.nodeStates.deploy?.status).toBe("success");
    expect(res.nodeStates.end?.status).toBe("success");

    const st = controller.status(runId);
    expect(st?.status).toBe("success");
    expect(st?.nodes.find((n) => n.id === "confirm")?.status).toBe("skipped");
  });

  it("3. batch-report: 3 项输入迭代清洗 → template 报告内容与汇总断言", async () => {
    const engine = new WorkflowEngine(createExecutors());
    const controller = new WorkflowController(engine, { workflowsDir: tmpDir });

    const val = controller.validate("batch-report.json");
    expect(val.ok).toBe(true);

    const inputFiles = [
      { name: "  Alpha_Report.CSV  ", size: 1024 },
      { name: "System_Metrics.LOG ", size: 2048 },
      { name: " Users_2025.JSON ", size: 4096 },
    ];

    const { runId } = await controller.run("batch-report.json", {
      files: inputFiles,
      title: "Quarterly Audit Report",
    });

    const res = await controller.waitFor(runId);
    expect(res.status).toBe("success");

    // 节点状态断言
    expect(res.nodeStates.start?.status).toBe("success");
    expect(res.nodeStates.clean_files?.status).toBe("success");
    expect(res.nodeStates.set_vars?.status).toBe("success");
    expect(res.nodeStates.render_report?.status).toBe("success");
    expect(res.nodeStates.end?.status).toBe("success");

    // 迭代输出清洗断言
    const cleanedItems = (res.outputs.clean_files as { items: Array<{ name: string; size: number; valid: boolean }> }).items;
    expect(cleanedItems).toHaveLength(3);
    expect(cleanedItems[0]).toEqual({
      name: "alpha_report.csv",
      size: 1024,
      valid: true,
    });
    expect(cleanedItems[1]).toEqual({
      name: "system_metrics.log",
      size: 2048,
      valid: true,
    });
    expect(cleanedItems[2]).toEqual({
      name: "users_2025.json",
      size: 4096,
      valid: true,
    });

    // 模板渲染输出断言
    const renderedText = (res.outputs.render_report as { result: string }).result;
    expect(renderedText).toContain("# Quarterly Audit Report");
    expect(renderedText).toContain("alpha_report.csv");
    expect(renderedText).toContain("system_metrics.log");
    expect(renderedText).toContain("users_2025.json");
    expect(renderedText).toContain("Status: All items processed successfully.");

    // End 节点终态输出透传
    expect(res.outputs.end?.status).toBe("success");
    expect(res.outputs.end?.report).toBe(renderedText);
  });
});
