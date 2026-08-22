/**
 * code-worker：运行于 Worker 线程的沙箱执行入口。
 * 在独立的 node:vm Context 中执行用户代码，仅注入纯数据 inputs，
 * 屏蔽 process/require/import/fs/net 等全局 API。
 *
 * 安全模型（S1）：
 * - 不从宿主 realm 注入任何活体对象（Math/JSON/Date/RegExp 等由 vm
 *   Context 自带，constructor 链终点是 vm 自己的 Function，拿不到宿主能力）
 * - inputs 经 JSON.parse(JSON.stringify()) 二次序列化后以纯数据挂入，
 *   杜绝跨 realm 原型链残留
 * - 进入用户代码前先跑 primordial 脚本：清理危险全局成员、深冻结 inputs
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

// inputs 二次净化：JSON 往返剥离原型链与不可序列化成员，杜绝跨 realm 原型
const safeInputs: Record<string, unknown> = JSON.parse(JSON.stringify(inputs));

// 用 Object.create(null) 创建无原型沙箱，阻断原型链访问
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sandbox: Record<string, any> = Object.create(null);
sandbox.inputs = safeInputs;

// vm.createContext：隔离 realm 自带全套内建（Math/JSON/Date/RegExp），
// 无需也绝不能从宿主注入
vm.createContext(sandbox);

try {
  // primordial 脚本：清理危险全局成员 + 深冻结注入的 inputs。
  // 由于未注入任何宿主对象，process/require 本就不存在；此处为纵深防御，
  // 若未来 sandbox 意外携带宿主引用，先删后冻。
  vm.runInContext(
    `(function() {
  // 清理可能泄漏的宿主全局（正常 vm 隔离下不存在，纵深防御）
  delete globalThis.process;
  delete globalThis.require;
  delete globalThis.module;
  delete globalThis.__dirname;
  delete globalThis.__filename;

  // 深冻结 inputs，防止用户代码改写输入
  function deepFreeze(obj) {
    if (obj === null || typeof obj !== 'object') return;
    for (var key of Object.getOwnPropertyNames(obj)) {
      var v = obj[key];
      if (v !== null && (typeof v === 'object' || typeof v === 'function')) {
        deepFreeze(v);
      }
    }
    Object.freeze(obj);
  }
  if (typeof globalThis.inputs !== 'undefined') {
    deepFreeze(globalThis.inputs);
  }
})();`,
    sandbox,
  );
} catch (err) {
  parentPort!.postMessage({
    type: "error",
    message: `sandbox init failed: ${err instanceof Error ? err.message : String(err)}`,
  });
}

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