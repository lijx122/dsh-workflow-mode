import vm from "node:vm";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

// 探针 1：主线程 vm context 内 constructor 链能否触达宿主 process
function probeInVm() {
  const sandbox = Object.create(null);
  vm.createContext(sandbox);
  sandbox.__raw = JSON.stringify({ x: 1 });
  try {
    const r = vm.runInContext(
      `(function() {
        globalThis.inputs = JSON.parse(globalThis.__raw);
        var hit1 = inputs.constructor.constructor('return typeof process')();
        var hit2 = typeof Function;
        return { hit1: hit1, typeofFunction: hit2, proc: inputs.constructor.constructor('return typeof process')() === 'object' };
      })()`,
      sandbox,
    );
    console.log("MAIN-THREAD VM PROBE:", JSON.stringify(r));
    return r;
  } catch (e) {
    console.log("MAIN-THREAD VM PROBE THREW:", e.message);
    return { threw: e.message };
  }
}

// 探针 2：Worker 线程内 vm context 同样探针
function probeInWorker() {
  const workerCode = `
    import { parentPort, workerData } from "node:worker_threads";
    import vm from "node:vm";
    const sandbox = Object.create(null);
    vm.createContext(sandbox);
    sandbox.__raw = JSON.stringify({ x: 1 });
    try {
      const r = vm.runInContext(
        \`(function() {
          globalThis.inputs = JSON.parse(globalThis.__raw);
          return { hit1: inputs.constructor.constructor('return typeof process')(), proc: inputs.constructor.constructor('return typeof process')() === 'object' };
        })()\`,
        sandbox,
      );
      parentPort.postMessage({ ok: true, r });
    } catch (e) {
      parentPort.postMessage({ ok: false, msg: e.message });
    }
  `;
  return new Promise((resolve, reject) => {
    const w = new Worker(workerCode, { eval: true });
    w.on("message", (m) => resolve(m));
    w.on("error", (e) => reject(e));
    w.on("exit", (c) => resolve({ exited: c }));
  });
}

if (isMainThread) {
  probeInVm();
  probeInWorker().then((r) => {
    console.log("WORKER VM PROBE:", JSON.stringify(r));
    process.exit(0);
  });
} else {
  // worker entry for probe 2 runs via eval:true script, not here
}