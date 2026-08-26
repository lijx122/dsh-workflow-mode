/**
 * code-worker：运行于 Worker 线程的沙箱执行入口。
 * 在独立的 node:vm Context 中执行用户代码，仅注入纯数据 inputs，
 * 屏蔽 process/require/import/fs/net 等全局 API。
 *
 * 安全模型（S1）：
 * - 不从宿主 realm 注入任何活体对象（Math/JSON/Date/RegExp 等由 vm
 *   Context 自带，constructor 链终点是 vm 自己的 Function，拿不到宿主能力）
 * - inputs 宿主侧仅序列化为字符串注入，由 vm 自己的 JSON.parse 在沙箱
 *   realm 内重建纯数据对象，constructor 链闭环于 vm（修1）
 * - 进入用户代码前先跑 primordial 脚本：清理危险全局成员、vm 内重建并
 *   深冻结 inputs；primordial 失败即终止，用户代码绝不运行（修2）
 *
 * 接收 workerData: { code: string, inputs: Record<string, JsonValue> }
 * 向主线程 postMessage: { type: "result", value } 或 { type: "error", message }
 */
import { parentPort, workerData } from "node:worker_threads";
import vm from "node:vm";

function main(): void {
  const { code, inputs } = workerData as {
    code: string;
    inputs: Record<string, unknown>;
  };

  // 宿主侧仅注入字符串（原始值，不携带原型链），由 vm realm 内 JSON.parse
  // 重建 inputs 对象——constructor 链终点为 vm 自己的 Function，无法经
  // .constructor.constructor("return process")() 触达宿主（修1）
  const rawInputs: string = JSON.stringify(inputs);

  // 用 Object.create(null) 创建无原型沙箱，阻断原型链访问
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sandbox: Record<string, any> = Object.create(null);
  sandbox.__rawInputs = rawInputs;

  // vm.createContext：隔离 realm 自带全套内建（Math/JSON/Date/RegExp），
  // 无需也绝不能从宿主注入
  vm.createContext(sandbox);

  // 中和 constructor 链：遮蔽 Function/eval 全局名，阻断
  // inputs.constructor.constructor("return process")() 类跨 realm 逃逸路径。
  // 注：vm Context 与宿主共享同一 Function 构造器做 contextify，
  // 仅靠"不注入活体对象"不闭合攻击面，必须显式遮蔽（对抗性审查 P0-1）。
  try {
    vm.runInContext("var Function = undefined; var eval = undefined;", sandbox);
  } catch (err) {
    parentPort!.postMessage({
      type: "error",
      message: `sandbox init failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    // primordial 失败即终止，用户代码绝不运行
    return;
  }

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

  // 深冻结 inputs，防止用户代码改写输入；WeakSet 已访集合防循环引用
  // 导致无限递归（修3）
  function deepFreeze(obj, seen) {
    if (obj === null || (typeof obj !== 'object' && typeof obj !== 'function')) return;
    if (seen.has(obj)) return;
    seen.add(obj);
    for (var key of Object.getOwnPropertyNames(obj)) {
      var v = obj[key];
      if (v !== null && (typeof v === 'object' || typeof v === 'function')) {
        deepFreeze(v, seen);
      }
    }
    Object.freeze(obj);
  }

  // 在 vm realm 内重建 inputs：JSON.parse 产出 vm 对象，constructor 链
  // 闭环于 vm 自己的 Function，杜绝跨 realm 活体对象（修1）
  globalThis.inputs = JSON.parse(globalThis.__rawInputs);
  delete globalThis.__rawInputs;
  deepFreeze(globalThis.inputs, new WeakSet());
})();`,
      sandbox,
    );
  } catch (err) {
    parentPort!.postMessage({
      type: "error",
      message: `sandbox init failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    // 修2：primordial 失败即终止，用户代码绝不运行；worker 自然退出
    return;
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
}

main();