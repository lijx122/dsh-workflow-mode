import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  validateWorkflow,
  type WorkflowDSL,
  type ValidateResult,
  type ValidateError,
} from "@dsh-workflow/schema";
import {
  WorkflowEngine,
  WorkflowValidationError,
  type JsonValue,
  type RunResult,
  type RunEvent,
  type NodeStatus,
  type NodeState,
  type NodeOutput,
  type RunStatus,
} from "@dsh-workflow/engine";

import { WorkflowFileWatcher } from "./watcher.js";
import { RetentionCleaner, type RetentionPolicy } from "./retention.js";
import { ensureN8nWorkflowSkillInstalled } from "./skill-installer.js";
import { startN8nService } from "./n8n-daemon.js";

export interface WorkflowControllerOptions {
  workflowsDir?: string;
  watcher?: boolean;
  debounceMs?: number;
  onRegistryChange?: (file: string) => void;
  retention?: RetentionPolicy;
}

export interface RunHistorySummary {
  runId: string;
  workflowName: string;
  status: string;
  startedAt: number;
  finishedAt?: number;
}

export interface StatusResult {
  runId: string;
  workflowName?: string;
  status: RunStatus;
  startedAt: number;
  finishedAt?: number;
  nodes: Array<{
    id: string;
    status: NodeStatus;
    startedAt?: number;
    finishedAt?: number;
    error?: string;
  }>;
  nodeStates?: Record<string, NodeState>;
}

export interface RunCheckpointData {
  runId: string;
  workflowName: string;
  status: RunStatus;
  startedAt: number;
  finishedAt?: number;
  inputs: Record<string, JsonValue>;
  nodeStates: Record<
    string,
    {
      status: NodeStatus;
      startedAt?: number;
      finishedAt?: number;
      error?: string;
      outputs?: Record<string, JsonValue>;
      waitingData?: JsonValue;
    }
  >;
}

export class WorkflowController {
  readonly engine: WorkflowEngine;
  readonly workflowsDir: string;
  readonly registry = new Map<string, { dsl: WorkflowDSL; version: number }>();
  private readonly versions = new Map<string, number>();
  private readonly activeRuns = new Map<
    string,
    {
      promise: Promise<RunResult>;
      runDir: string;
      workflowName: string;
    }
  >();
  readonly fileWatcher?: WorkflowFileWatcher;
  readonly retentionCleaner: RetentionCleaner;
  onRegistryChange?: (file: string) => void;

  constructor(engine: WorkflowEngine, opts: WorkflowControllerOptions = {}) {
    ensureN8nWorkflowSkillInstalled();
    void startN8nService().catch((e) => console.warn('[dsh-workflow] n8n auto-start notice:', e));
    this.engine = engine;
    this.workflowsDir = opts.workflowsDir ?? path.resolve(".dsh/workflows");
    this.onRegistryChange = opts.onRegistryChange;
    this.retentionCleaner = new RetentionCleaner(
      path.join(this.workflowsDir, "runs"),
      opts.retention,
    );

    // 引擎启动时惰性清理（不阻塞主流程）
    void this.retentionCleaner.clean().catch((err) => {
      console.warn("Retention cleaner error on startup:", err);
    });

    // 启动时对账：崩溃遗留的僵尸 "running" 状态标记为 interrupted（不阻塞主流程）
    try {
      this.reconcileStaleRuns();
    } catch (err) {
      console.warn("Reconcile stale runs error on startup:", err);
    }

    if (opts.watcher) {
      this.fileWatcher = new WorkflowFileWatcher({
        workflowsDir: this.workflowsDir,
        debounceMs: opts.debounceMs,
        onValid: (file, dsl) => {
          const current = this.registry.get(file);
          const version =
            (current ? current.version : (this.versions.get(file) ?? 0)) + 1;
          this.registry.set(file, { dsl, version });
          this.versions.set(file, version);
          if (this.onRegistryChange) {
            this.onRegistryChange(file);
          }
        },
        onInvalid: (_file, _errors) => {
          // 失败→last-good 回退通知（保持原 registry 不变）
        },
        onDelete: (file) => {
          this.registry.delete(file);
          this.versions.delete(file);
          if (this.onRegistryChange) {
            this.onRegistryChange(file);
          }
        },
      });
      this.fileWatcher.start();
    }
  }

  /**
   * 原子写入 JSON 文件：先写临时文件，再 rename 覆盖
   */
  private atomicWriteJson(filePath: string, data: unknown): void {
    const tmpPath = filePath + "." + crypto.randomUUID() + ".tmp";
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
      // Windows 上 fs.renameSync 不能覆盖，先删除再 rename
      if (fs.existsSync(filePath)) {
        fs.rmSync(filePath, { force: true });
      }
      fs.renameSync(tmpPath, filePath);
    } catch (err) {
      // 清理临时文件
      try { fs.rmSync(tmpPath, { force: true }); } catch { /* ignore */ }
      throw err;
    }
  }

  /**
   * 解析工作流文件路径，拒绝路径穿越（sandbox escape）
   */
  private resolveFilePath(file: string): string {
    const resolved = path.isAbsolute(file)
      ? file
      : path.resolve(this.workflowsDir, file);
    // 规范化后检查是否仍在 workflowsDir 内
    const normalized = path.resolve(resolved);
    const base = path.resolve(this.workflowsDir);
    if (!normalized.startsWith(base + path.sep) && normalized !== base) {
      throw new Error(`Path traversal denied: "${file}" escapes workflow sandbox`);
    }
    // 对抗性审查 P1-2：字符串前缀检查不防符号链接——文件已存在时
    // 用 realpath 复核真实落点仍在沙箱内
    try {
      const real = fs.realpathSync(normalized);
      if (!real.startsWith(base + path.sep) && real !== base) {
        throw new Error(
          `Path traversal denied via symlink: "${file}" resolves outside workflow sandbox`,
        );
      }
      return real;
    } catch (err) {
      if (err instanceof Error && err.message.includes("Path traversal denied")) throw err;
      // 文件不存在等场景：保留规范化路径（后续 existsSync 自会报错）
      return normalized;
    }
  }

  /**
   * 校验 runId 为 UUID 格式，拒绝路径注入（对抗性审查 P1-1）
   */
  private assertRunId(runId: string): void {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(runId)) {
      throw new Error(`Invalid runId: "${runId}"`);
    }
  }

  /**
   * 对账僵尸运行：进程崩溃后残留 "running"/"waiting_human" 状态的 run 标记为 "interrupted"
   */
  reconcileStaleRuns(): { marked: number } {
    const runsBase = path.join(this.workflowsDir, "runs");
    if (!fs.existsSync(runsBase)) {
      return { marked: 0 };
    }

    let marked = 0;
    try {
      const wfDirs = fs.readdirSync(runsBase, { withFileTypes: true });
      for (const wfDir of wfDirs) {
        if (!wfDir.isDirectory()) continue;
        const wfDirPath = path.join(runsBase, wfDir.name);
        let runDirs: fs.Dirent[];
        try {
          runDirs = fs.readdirSync(wfDirPath, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const runDir of runDirs) {
          if (!runDir.isDirectory()) continue;
          const runJsonPath = path.join(wfDirPath, runDir.name, "run.json");
          try {
            if (!fs.existsSync(runJsonPath)) continue;
            const data = JSON.parse(
              fs.readFileSync(runJsonPath, "utf-8"),
            ) as RunCheckpointData;
            if (data.status === "running" || data.status === "waiting_human") {
              data.status = "interrupted";
              data.finishedAt = Date.now();
              const nodes = data.nodeStates || {};
              for (const ns of Object.values(nodes)) {
                if (ns.status === "running" || ns.status === "waiting_human") {
                  ns.status = "interrupted";
                  ns.finishedAt = Date.now();
                }
              }
              this.atomicWriteJson(runJsonPath, data);
              marked++;
            }
          } catch {
            // 跳过损坏的 run.json
          }
        }
      }
    } catch {
      return { marked };
    }

    return { marked };
  }

  /**
   * 1. list: 返回 workflowsDir 下 *.json 文件名数组
   */
  list(): string[] {
    if (!fs.existsSync(this.workflowsDir)) {
      return [];
    }
    try {
      const entries = fs.readdirSync(this.workflowsDir, { withFileTypes: true });
      return entries
        .filter((e: fs.Dirent) => e.isFile() && e.name.endsWith(".json"))
        .map((e: fs.Dirent) => e.name)
        .sort();
    } catch {
      return [];
    }
  }

  /**
   * 2. validate: 重新读取并经 schema 包 validateWorkflow 校验
   */
  validate(file: string): ValidateResult {
    const filePath = this.resolveFilePath(file);
    if (!fs.existsSync(filePath)) {
      return {
        ok: false,
        errors: [
          {
            path: "",
            code: "SCHEMA",
            message: `Workflow file not found: ${filePath}`,
          },
        ],
      };
    }

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(content);
      return validateWorkflow(parsed);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        errors: [
          {
            path: "",
            code: "SCHEMA",
            message: `Failed to parse JSON in file "${file}": ${msg}`,
          },
        ],
      };
    }
  }

  /**
   * 3. run: 读文件 -> 校验 -> engine.run(dsl, params) -> { runId }
   */
  async run(
    file: string,
    params: Record<string, JsonValue> = {},
  ): Promise<{ runId: string }> {
    let dsl: WorkflowDSL;
    const normalizedKey = path
      .relative(this.workflowsDir, this.resolveFilePath(file))
      .replace(/\\/g, "/");
    const cached = this.registry.get(file) ?? this.registry.get(normalizedKey);

    if (cached) {
      dsl = structuredClone(cached.dsl);
    } else {
      const filePath = this.resolveFilePath(file);
      const val = this.validate(file);
      if (!val.ok) {
        throw new WorkflowValidationError(val);
      }
      const content = fs.readFileSync(filePath, "utf-8");
      dsl = JSON.parse(content) as WorkflowDSL;
    }

    const runId = crypto.randomUUID();
    // 对抗性审查（文档一致性 P1-1）：FR-12 契约——目录名取文件 basename
    // 经 slug 清洗仅保留 [a-zA-Z0-9_-]，dsl.name 仅作展示不参与拼路径
    const rawName = path.basename(file, ".json") || dsl.name || "workflow";
    let workflowName = rawName.replace(/[^a-zA-Z0-9_-]/g, "_");
    if (!workflowName) workflowName = "workflow";

    const runDir = path.join(this.workflowsDir, "runs", workflowName, runId);
    fs.mkdirSync(runDir, { recursive: true });

    const eventsPath = path.join(runDir, "events.jsonl");
    const runJsonPath = path.join(runDir, "run.json");

    const checkpoint: RunCheckpointData = {
      runId,
      workflowName: dsl.name,
      status: "running",
      startedAt: Date.now(),
      inputs: structuredClone(params),
      nodeStates: Object.fromEntries(
        dsl.nodes.map((n) => [n.id, { status: "pending" }]),
      ),
    };

    this.atomicWriteJson(runJsonPath, checkpoint);
    fs.writeFileSync(eventsPath, "", "utf-8");

    const onEvent = (event: RunEvent) => {
      try {
        fs.appendFileSync(eventsPath, JSON.stringify(event) + "\n", "utf-8");
        if (event.nodeId && checkpoint.nodeStates[event.nodeId]) {
          const ns = checkpoint.nodeStates[event.nodeId];
          if (event.type === "node_start") {
            ns.status = "running";
            ns.startedAt = event.timestamp;
          } else if (event.type === "node_finish") {
            ns.status = "success";
            ns.finishedAt = event.timestamp;
          } else if (event.type === "node_error") {
            ns.status = "failed";
            ns.finishedAt = event.timestamp;
            ns.error = (event.data?.error as string) ?? undefined;
          } else if (event.type === "node_skip") {
            ns.status = "skipped";
            ns.finishedAt = event.timestamp;
          } else if (event.type === "human_wait") {
            ns.status = "waiting_human";
            checkpoint.status = "waiting_human";
            ns.waitingData = event.data;
          }
        }
        this.atomicWriteJson(runJsonPath, checkpoint);
      } catch {
        // 日志追加容错
      }
    };

    // 启动引擎运行 —— host.askUser 必须传一个「永不自行 settle 的悬挂 Promise」：
    // 这是 Human 断点协议的核心原语。引擎层 makeCtx 会包装该 askUser：
    // 1) 将节点标记 waiting_human、注册到 control.pendingHumans 并发出 human_wait 事件；
    // 2) 包装 Promise 由 controller.approve()（pending.resolve）或 run 停止
    //    （AbortSignal 经 human 执行器 signalPromise）来终止。
    // 若改为立即 reject 或删除该 host，Human 节点会立刻失败而非等待审批（回归），
    // 因此这里保持悬挂设计，配合 approve/stop 闭环，不构成内存泄漏。
    const promise = this.engine
      .run(dsl, params, {
        runId,
        onEvent,
        host: {
          askUser: () =>
            new Promise<{ decision: string; inputs?: Record<string, JsonValue> }>(
              () => {},
            ),
        },
      })
      .then((res) => {
        checkpoint.status = res.status;
        checkpoint.finishedAt = Date.now();
        for (const [id, s] of Object.entries(res.nodeStates)) {
          checkpoint.nodeStates[id] = {
            ...checkpoint.nodeStates[id],
            status: s.status,
            startedAt: s.startedAt,
            finishedAt: s.finishedAt,
            error: s.error,
            outputs: res.outputs[id] as Record<string, JsonValue> | undefined,
          };
        }
        try {
          this.atomicWriteJson(runJsonPath, checkpoint);
        } catch {
          // ignore
        }
        return res;
      })
      .finally(() => {
        this.activeRuns.delete(runId);
        void this.retentionCleaner.clean().catch((err) => {
          console.warn("Retention cleaner error after run:", err);
        });
      });

    this.activeRuns.set(runId, { promise, runDir, workflowName });

    return { runId };
  }

  /**
   * 辅助方法：等待 run 完成
   */
  async waitFor(runId: string): Promise<RunResult> {
    const active = this.activeRuns.get(runId);
    if (active) {
      return active.promise;
    }
    const status = this.status(runId);
    if (!status) {
      throw new Error(`Run "${runId}" not found`);
    }
    return {
      runId,
      status: (status.status === "waiting_human" ? "failed" : status.status) as "success" | "failed" | "stopped",
      nodeStates: status.nodeStates ?? {},
      outputs: {},
      events: this.logs(runId).events,
    };
  }

  /**
   * 4. status: 透传 engine 或读 run.json
   */
  status(runId: string): StatusResult | undefined {
    // 对抗性审查 P1-1：runId 参与磁盘路径拼接，必须先校验格式
    this.assertRunId(runId);
    const engineStatus = this.engine.status(runId);
    if (engineStatus) {
      return {
        runId: engineStatus.runId,
        workflowName: engineStatus.workflowName,
        status: engineStatus.status,
        startedAt: engineStatus.startedAt,
        finishedAt: engineStatus.finishedAt,
        nodes: engineStatus.nodes,
        nodeStates: engineStatus.nodeStates,
      };
    }

    // 内存中无记录则扫描磁盘 runs 目录
    const runsBase = path.join(this.workflowsDir, "runs");
    if (!fs.existsSync(runsBase)) return undefined;

    try {
      const wfDirs = fs.readdirSync(runsBase, { withFileTypes: true });
      for (const wfDir of wfDirs) {
        if (!wfDir.isDirectory()) continue;
        const runJsonPath = path.join(runsBase, wfDir.name, runId, "run.json");
        if (fs.existsSync(runJsonPath)) {
          const data = JSON.parse(
            fs.readFileSync(runJsonPath, "utf-8"),
          ) as RunCheckpointData;
          return {
            runId: data.runId,
            workflowName: data.workflowName,
            status: data.status,
            startedAt: data.startedAt,
            finishedAt: data.finishedAt,
            nodes: Object.entries(data.nodeStates || {}).map(([id, s]) => ({
              id,
              status: s.status,
              startedAt: s.startedAt,
              finishedAt: s.finishedAt,
              error: s.error,
            })),
            nodeStates: data.nodeStates as Record<string, NodeState>,
          };
        }
      }
    } catch {
      return undefined;
    }

    return undefined;
  }

  /**
   * 5. stop: 透传 engine 并更新状态
   */
  stop(runId: string): { stopped: boolean } {
    const stopped = this.engine.stop(runId);
    return { stopped };
  }

  /**
   * 6. approve: 向挂起的 human 节点提交审批结果
   */
  approve(
    runId: string,
    nodeId: string,
    decision: "approved" | "rejected" | string,
    inputs?: Record<string, JsonValue>,
  ): { nodeId: string; decision: string; resumed: boolean } {
    return this.engine.approve(runId, nodeId, decision, inputs);
  }

  /**
   * 7. resume: 从内存态恢复
   */
  resume(runId: string): {
    resumed: boolean;
    nodes: Array<{ id: string; status: NodeStatus }>;
  } {
    return this.engine.resume(runId);
  }

  /**
   * 8. logs: 读 <workflowsDir>/runs/<name>/<runId>/events.jsonl 尾部 N 条
   */
  logs(
    runId: string,
    options?: { tail?: number; nodeId?: string } | number,
  ): { events: RunEvent[] } {
    const tail = typeof options === "number" ? options : options?.tail;
    const nodeId = typeof options === "object" ? options?.nodeId : undefined;

    // 对抗性审查 P1-1：runId 参与磁盘路径拼接，必须先校验格式
    this.assertRunId(runId);

    const runsBase = path.join(this.workflowsDir, "runs");
    let targetEventsFile: string | undefined;

    if (fs.existsSync(runsBase)) {
      try {
        const wfDirs = fs.readdirSync(runsBase, { withFileTypes: true });
        for (const wfDir of wfDirs) {
          if (!wfDir.isDirectory()) continue;
          const candidate = path.join(runsBase, wfDir.name, runId, "events.jsonl");
          if (fs.existsSync(candidate)) {
            targetEventsFile = candidate;
            break;
          }
        }
      } catch {
        // ignore
      }
    }

    if (!targetEventsFile || !fs.existsSync(targetEventsFile)) {
      return { events: [] };
    }

    try {
      // 对抗性审查 P1-3：大文件只读尾部，防止全量载入内存（>5MB 时取末尾 512KB）
      let raw: string;
      const stat = fs.statSync(targetEventsFile);
      if (stat.size > 5 * 1024 * 1024) {
        const fd = fs.openSync(targetEventsFile, "r");
        try {
          const tailBytes = 512 * 1024;
          const start = Math.max(0, stat.size - tailBytes);
          const buf = Buffer.alloc(stat.size - start);
          fs.readSync(fd, buf, 0, buf.length, start);
          raw = buf.toString("utf-8");
          // 丢弃首个可能被截断的半行
          if (start > 0) {
            const firstNl = raw.indexOf("\n");
            if (firstNl >= 0) raw = raw.slice(firstNl + 1);
          }
        } finally {
          fs.closeSync(fd);
        }
      } else {
        raw = fs.readFileSync(targetEventsFile, "utf-8");
      }
      const lines = raw.split("\n").filter((l: string) => l.trim().length > 0);
      let events: RunEvent[] = [];
      for (const l of lines) {
        try {
          events.push(JSON.parse(l) as RunEvent);
        } catch {
          // 跳过单行损坏，避免整文件丢失
        }
      }

      if (nodeId) {
        events = events.filter((e) => e.nodeId === nodeId);
      }

      if (typeof tail === "number" && tail > 0) {
        events = events.slice(-tail);
      }

      return { events };
    } catch {
      return { events: [] };
    }
  }

  /**
   * 9. history: runs 目录扫描摘要
   */
  history(name?: string, limit?: number): RunHistorySummary[] {
    const runsBase = path.join(this.workflowsDir, "runs");
    if (!fs.existsSync(runsBase)) return [];

    const summaries: RunHistorySummary[] = [];

    try {
      const targetDirs: string[] = [];
      if (name) {
        const sanitized = name.replace(/[^a-zA-Z0-9_-]/g, "_");
        const specific = path.join(runsBase, sanitized);
        if (fs.existsSync(specific)) targetDirs.push(specific);
      } else {
        const entries = fs.readdirSync(runsBase, { withFileTypes: true });
        for (const e of entries) {
          if (e.isDirectory()) {
            targetDirs.push(path.join(runsBase, e.name));
          }
        }
      }

      for (const dir of targetDirs) {
        const runDirs = fs.readdirSync(dir, { withFileTypes: true });
        for (const rd of runDirs) {
          if (!rd.isDirectory()) continue;
          const runJsonPath = path.join(dir, rd.name, "run.json");
          if (fs.existsSync(runJsonPath)) {
            try {
              const data = JSON.parse(
                fs.readFileSync(runJsonPath, "utf-8"),
              ) as RunCheckpointData;
              summaries.push({
                runId: data.runId,
                workflowName: data.workflowName,
                status: data.status,
                startedAt: data.startedAt,
                finishedAt: data.finishedAt,
              });
            } catch {
              // skip corrupted
            }
          }
        }
      }
    } catch {
      return [];
    }

    summaries.sort((a, b) => b.startedAt - a.startedAt);
    if (typeof limit === "number" && limit > 0) {
      return summaries.slice(0, limit);
    }
    return summaries;
  }

  /**
   * 10. test: 单节点干跑，构造单节点 DSL 直接 engine 跑，不产生正式 run 目录
   */
  async test(
    file: string,
    nodeId: string,
    inputs: Record<string, JsonValue> = {},
  ): Promise<NodeOutput> {
    const filePath = this.resolveFilePath(file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Workflow file not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const dsl = JSON.parse(content) as WorkflowDSL;

    const node = dsl.nodes.find((n) => n.id === nodeId);
    if (!node) {
      throw new Error(`Node "${nodeId}" not found in workflow file "${file}"`);
    }

    const targetNode = structuredClone(node);
    if (inputs && typeof inputs === "object") {
      const existingInputs =
        (targetNode as { inputs?: Record<string, JsonValue> }).inputs ?? {};
      (targetNode as { inputs?: Record<string, JsonValue> }).inputs = {
        ...existingInputs,
        ...inputs,
      };
    }

    const testDsl: WorkflowDSL = {
      version: "dsh.workflow.v1",
      name: `test_${nodeId}`,
      nodes: [targetNode],
      edges: [],
    };

    const res = await this.engine.run(testDsl, inputs, { isTest: true });
    if (res.status === "failed") {
      const err = res.nodeStates[nodeId]?.error || "Node test execution failed";
      throw new Error(err);
    }
    return res.outputs[nodeId] ?? {};
  }

  /**
   * 11. reload: 重新校验并递增内部版本号
   */
  reload(file: string): {
    version: number;
    ok: boolean;
    errors?: ValidateError[];
  } {
    const val = this.validate(file);
    const normalizedKey = path
      .relative(this.workflowsDir, this.resolveFilePath(file))
      .replace(/\\/g, "/");
    const current =
      this.registry.get(file)?.version ??
      this.registry.get(normalizedKey)?.version ??
      this.versions.get(file) ??
      this.versions.get(normalizedKey) ??
      0;
    if (val.ok) {
      const next = current + 1;
      const filePath = this.resolveFilePath(file);
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const dsl = JSON.parse(content) as WorkflowDSL;
        this.registry.set(file, { dsl, version: next });
        this.registry.set(normalizedKey, { dsl, version: next });
      } catch {
        // ignore
      }
      this.versions.set(file, next);
      this.versions.set(normalizedKey, next);
      this.onRegistryChange?.(file);
      return { version: next, ok: true };
    }
    return { version: current, ok: false, errors: val.errors };
  }

  /**
   * 停止文件监听
   */
  async stopWatcher(): Promise<void> {
    if (this.fileWatcher) {
      await this.fileWatcher.stop();
    }
  }
}
