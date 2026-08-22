import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import type { NodeExecutor, NodeOutput } from "../engine.js";
import type { ExecutionContext } from "../engine.js";
import type { JsonValue } from "../variable-context.js";
import type { CodeNode } from "@dsh-workflow/schema";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 解析 code-worker 入口路径。
 * 生产构建时 __dirname = lib/executors/，同目录下有 code-worker.js；
 * 测试（vitest 源运行）时 __dirname = src/executors/，.js 不存在，回退到 lib/ 编译产物。
 */
function resolveWorkerPath(): string {
  // 生产场景：同目录编译产物
  const local = resolve(__dirname, "./code-worker.js");
  if (existsSync(local)) return local;
  // 测试/开发场景：回退到 lib/ 编译产物
  const lib = resolve(__dirname, "../../lib/executors/code-worker.js");
  if (existsSync(lib)) return lib;
  return local;
}

const WORKER_PATH = resolveWorkerPath();

/**
 * code：Worker 线程 + node:vm 隔离的代码执行器。
 * 在独立 Worker 线程内新建 vm Context，仅注入 inputs 与只读基础对象
 * (Math/JSON/Date/RegExp)，屏蔽 process/require/import/fs/net。
 * ctx.signal abort 时立即 worker.terminate() 强制熔断。
 * 超时由引擎统一管理（execWithinTimeout），此处响应 signal 即可。
 *
 * 用户代码形如 "return inputs.x" 的函数体。
 */
export const codeExecutor: NodeExecutor = {
  type: "code",
  async execute(
    node: CodeNode,
    inputs: Record<string, NodeOutput[string]>,
    ctx: ExecutionContext,
  ): Promise<NodeOutput> {
    const worker = new Worker(WORKER_PATH, {
      workerData: { code: node.code, inputs },
    });

    const abortHandler = () => {
      worker.terminate().catch(() => {});
    };
    ctx.signal.addEventListener("abort", abortHandler, { once: true });

    try {
      const result = await new Promise<unknown>((resolve, reject) => {
        worker.on("message", (msg: { type: string; value?: unknown; message?: string }) => {
          if (msg.type === "result") {
            resolve(msg.value);
          } else if (msg.type === "error") {
            reject(new Error(msg.message ?? "Unknown worker error"));
          }
        });
        worker.on("error", (err: Error) => {
          reject(new Error(`Worker error: ${err.message}`));
        });
        worker.on("exit", (exitCode: number) => {
          if (exitCode !== 0) {
            // 如果 worker 已被 terminate() 终止，exit code 1 是预期行为
            reject(new Error(`Worker exited with code ${exitCode}`));
          }
        });
      });

      if (typeof result === "object" && result !== null && !Array.isArray(result)) {
        return result as NodeOutput;
      }
      return { result: result as JsonValue };
    } finally {
      ctx.signal.removeEventListener("abort", abortHandler);
      await worker.terminate().catch(() => {});
    }
  },
};
