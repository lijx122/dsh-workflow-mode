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
 * 在独立 Worker 线程内新建 vm Context，仅注入纯数据 inputs（Math/JSON/Date
 * /RegExp 由 vm 自带，不从宿主注入），屏蔽 process/require/import/fs/net。
 * ctx.signal abort 时立即 worker.terminate() 强制熔断。
 * 超时由引擎统一管理（execWithinTimeout），此处响应 signal 即可。
 * Worker 以 0 退出且未 postMessage 时（异常路径），reject 防 promise 挂起。
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
      // 资源上限：防沙箱内代码内存爆炸拖垮宿主（对抗性审查 P0-1 加固）
      resourceLimits: {
        maxOldGenerationSizeMb: 128,
        maxYoungGenerationSizeMb: 32,
      },
    });

    const abortHandler = () => {
      worker.terminate().catch(() => {});
    };
    ctx.signal.addEventListener("abort", abortHandler, { once: true });

    try {
      const result = await new Promise<unknown>((resolve, reject) => {
        // 标记 promise 是否已落定：exit 事件据此判断"无消息退出"路径
        let settled = false;
        const settle = (fn: () => void) => {
          if (settled) return;
          settled = true;
          fn();
        };

        worker.on("message", (msg: { type: string; value?: unknown; message?: string }) => {
          if (msg.type === "result") {
            settle(() => resolve(msg.value));
          } else if (msg.type === "error") {
            settle(() => reject(new Error(msg.message ?? "Unknown worker error")));
          }
        });
        worker.on("error", (err: Error) => {
          settle(() => reject(new Error(`Worker error: ${err.message}`)));
        });
        worker.on("exit", (exitCode: number) => {
          // S2：Worker 以 0 退出却未发任何消息（异常路径）时，promise 永不
          // 落定会挂起调用方——此处一律 reject（若已被 terminate() 终止则
          // exit 事件重复触发也无妨，settle 幂等）
          if (exitCode === 0) {
            settle(() => reject(new Error("worker exited without result")));
          } else {
            // 如果 worker 已被 terminate() 终止，exit code 1 是预期行为
            settle(() => reject(new Error(`Worker exited with code ${exitCode}`)));
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
