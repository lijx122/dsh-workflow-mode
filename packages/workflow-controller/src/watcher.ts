import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { watch, type FSWatcher } from "chokidar";
import {
  validateWorkflow,
  type WorkflowDSL,
  type ValidateError,
} from "@dsh-workflow/schema";

export interface WorkflowFileWatcherOptions {
  workflowsDir: string;
  onValid: (file: string, dsl: WorkflowDSL) => void;
  onInvalid: (file: string, errors: ValidateError[]) => void;
  onDelete?: (file: string) => void;
  debounceMs?: number;
}

export class WorkflowFileWatcher {
  private readonly opts: WorkflowFileWatcherOptions;
  private readonly debounceMs: number;
  private watcher: FSWatcher | null = null;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly lastHashes = new Map<string, string>();
  private stopped = false;

  constructor(opts: WorkflowFileWatcherOptions) {
    this.opts = opts;
    this.debounceMs = opts.debounceMs ?? 300;
  }

  /**
   * 启动 chokidar 监听 workflowsDir/*.json，add/change 事件进入 debounce 管线
   */
  start(): void {
    if (this.stopped || this.watcher) {
      return;
    }

    const dir = path.resolve(this.opts.workflowsDir);
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch {
        // ignore mkdir error
      }
    }

    this.watcher = watch(dir, {
      depth: 0,
      ignoreInitial: false,
    });

    const handleEvent = (event: string, fullPath: string) => {
      if (this.stopped) {
        return;
      }
      if (event !== "add" && event !== "change" && event !== "unlink") {
        return;
      }
      if (!fullPath.endsWith(".json")) {
        return;
      }

      const normalizedPath = path.resolve(fullPath);
      const relativeFile = path
        .relative(dir, normalizedPath)
        .replace(/\\/g, "/");

      // 删除事件：清哈希与防抖计时器，直接回调 onDelete
      if (event === "unlink") {
        const existingTimer = this.timers.get(relativeFile);
        if (existingTimer) {
          clearTimeout(existingTimer);
          this.timers.delete(relativeFile);
        }
        this.lastHashes.delete(relativeFile);
        this.opts.onDelete?.(relativeFile);
        return;
      }

      const existingTimer = this.timers.get(relativeFile);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      const timer = setTimeout(() => {
        this.timers.delete(relativeFile);
        this.processFile(normalizedPath, relativeFile);
      }, this.debounceMs);

      this.timers.set(relativeFile, timer);
    };

    this.watcher.on("all", handleEvent);
  }

  /**
   * 处理单个文件：读取 -> sha1 哈希比对 -> parse + validate -> 分流
   */
  private processFile(fullPath: string, relativeFile: string): void {
    if (this.stopped) {
      return;
    }

    if (!fs.existsSync(fullPath)) {
      return;
    }

    let content: string;
    try {
      content = fs.readFileSync(fullPath, "utf-8");
    } catch {
      return;
    }

    // 内容哈希去重：同文件内容 sha1 未变则跳过回调
    const hash = crypto.createHash("sha1").update(content).digest("hex");
    if (this.lastHashes.get(relativeFile) === hash) {
      return;
    }
    this.lastHashes.set(relativeFile, hash);

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const errors: ValidateError[] = [
        {
          path: "",
          code: "SCHEMA",
          message: `Failed to parse JSON in file "${relativeFile}": ${msg}`,
        },
      ];
      this.opts.onInvalid(relativeFile, errors);
      return;
    }

    const isN8nWorkflow =
      typeof parsed === "object" &&
      parsed !== null &&
      Array.isArray((parsed as any).nodes) &&
      typeof (parsed as any).connections === "object";

    if (isN8nWorkflow) {
      this.opts.onValid(relativeFile, parsed as any);
      return;
    }

    const val = validateWorkflow(parsed);
    if (val.ok) {
      this.opts.onValid(relativeFile, parsed as WorkflowDSL);
    } else {
      this.opts.onInvalid(relativeFile, val.errors);
    }
  }

  /**
   * 停止文件监听并清理计时器
   */
  async stop(): Promise<void> {
    this.stopped = true;
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }
}
