/**
 * code-worker：运行于 Worker 线程的沙箱执行入口。
 * 在独立的 node:vm Context 中执行用户代码，仅注入 inputs 和只读基础对象，
 * 屏蔽 process/require/import/fs/net 等全局 API。
 *
 * 接收 workerData: { code: string, inputs: Record<string, JsonValue> }
 * 向主线程 postMessage: { type: "result", value } 或 { type: "error", message }
 */
import { parentPort, workerData } from "node:worker_threads";
import vm from "node:vm";

const { code, inputs } = workerData as {
  code: string;
  inputs: Record<string, unknown>;
};

// 用 Object.create(null) 创建无原型沙箱，阻断原型链访问
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sandbox: Record<string, any> = Object.create(null);
sandbox.inputs = inputs;
sandbox.Math = Math;
sandbox.JSON = JSON;
sandbox.Date = Date;
sandbox.RegExp = RegExp;

vm.createContext(sandbox);

try {
  // 用户代码形如 "return inputs.x" 的函数体，包裹为立即执行函数
  const wrappedCode = `(function() { ${code} })()`;
  const result = vm.runInContext(wrappedCode, sandbox, {
    timeout: 30000,
    breakOnSigint: false,
  });
  parentPort!.postMessage({ type: "result", value: result });
} catch (err) {
  parentPort!.postMessage({
    type: "error",
    message: err instanceof Error ? err.message : String(err),
  });
}
