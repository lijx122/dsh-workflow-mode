/**
 * 本地（纯逻辑）节点执行器 (M3, design §5.1 / §10 P1-16)。
 *
 * 覆盖：start / end / if_else / switch / merge / set_variable / template /
 * iteration / code。语义与 packages/engine 同名执行器对齐（表达式经
 * VariableContext、路由输出约定 { branch }、iteration 聚合 { items }），
 * 但按 §10 P1-16 调整两点：
 * - iteration：内联子队列循环，每次迭代串行跑完 body（不做并发）；
 * - code：new Function + 冻结白名单（console/Math/JSON/输入变量），
 *   网络/DOM 标识符参数级 shadow 置 undefined；Worker 方案为 TECH_DEBT。
 *
 * 复用说明：engine 执行器本体依赖 node:worker_threads/p-queue（浏览器不可
 * 用）且 @dsh-workflow/engine 未在 client-ui-workflow 声明依赖（package.json
 * 非本模块所有权，已上报集成冲突），故此处为语义对齐的独立实现。
 */
import type { WorkflowNode } from '@dsh-workflow/schema';
import { VariableContext, type JsonValue } from './variable-context.js';

// ---------------- 公共类型 ----------------

export type NodeOutput = Record<string, JsonValue>;

export interface ExecutorContext {
  runId: string;
  nodeId: string;
  signal: AbortSignal;
  log(msg: string): void;
  varCtx: VariableContext;
  /** merge 使用：全部前驱节点 id（编排器注入）。 */
  predecessors?: string[];
  /** 编排器已解析的节点声明 inputs（占位符 ref 后），code 执行器消费。 */
  inputs?: Record<string, JsonValue>;
}

/** 全类型节点派发器：orchestrator 注入，iteration body 执行经由它。 */
export type NodeDispatcher = (
  node: WorkflowNode,
  ctx: ExecutorContext,
  inputsOverride?: Record<string, JsonValue>,
) => Promise<NodeOutput>;

export type LocalExecutor = (
  node: WorkflowNode,
  ctx: ExecutorContext,
  dispatcher: NodeDispatcher,
) => Promise<NodeOutput>;

/** 中止错误（orchestrator 据此识别中止路径）。 */
export class AbortedError extends Error {
  constructor(nodeId: string) {
    super(`节点 "${nodeId}" 已中止`);
    this.name = 'AbortedError';
  }
}

function ensureNotAborted(ctx: ExecutorContext): void {
  if (ctx.signal.aborted) throw new AbortedError(ctx.nodeId);
}

// ---------------- start / end ----------------

const startExecutor: LocalExecutor = async (node) => {
  const outputs: NodeOutput = {};
  const params = (node as { inputs?: Record<string, { default?: unknown }> }).inputs;
  if (params && typeof params === 'object') {
    for (const [name, param] of Object.entries(params)) {
      if (param && param.default !== undefined) {
        outputs[name] = param.default as JsonValue;
      }
    }
  }
  return outputs;
};

const endExecutor: LocalExecutor = async (node, ctx) => {
  const refs = (node as { outputs?: Record<string, string> }).outputs ?? {};
  const output: NodeOutput = {};
  for (const [key, ref] of Object.entries(refs)) {
    output[key] = ctx.varCtx.ref(ref);
  }
  return output;
};

// ---------------- 路由：if_else / switch ----------------

const ifElseExecutor: LocalExecutor = async (node, ctx) => {
  const condition = (node as { condition?: string }).condition ?? '';
  const result = ctx.varCtx.evalExpr(condition);
  return { branch: result ? 'true' : 'false' };
};

interface SwitchCaseLike {
  when?: string;
  condition?: string;
  value?: string;
  target?: string;
}

const switchExecutor: LocalExecutor = async (node, ctx) => {
  const raw = node as {
    cases?: Array<string | SwitchCaseLike>;
    defaultCase?: string;
    default?: string;
    expression?: string;
  };
  const cases = Array.isArray(raw.cases) ? raw.cases : [];
  let matched: string | undefined;

  for (const c of cases) {
    if (typeof c === 'string') {
      if (raw.expression) {
        if (String(ctx.varCtx.evalExpr(raw.expression)) === c) { matched = c; break; }
      } else if (ctx.varCtx.evalExpr(c)) {
        matched = c;
        break;
      }
    } else if (c && typeof c === 'object') {
      const expr = c.when ?? c.condition;
      if (expr) {
        if (ctx.varCtx.evalExpr(expr)) { matched = c.value ?? c.target ?? expr; break; }
      } else if (c.value && raw.expression) {
        if (String(ctx.varCtx.evalExpr(raw.expression)) === c.value) { matched = c.value; break; }
      }
    }
  }

  if (matched === undefined) matched = raw.defaultCase ?? raw.default ?? 'default';
  return { branch: matched };
};

// ---------------- merge / set_variable / template ----------------

function deepMerge(target: unknown, source: unknown): unknown {
  if (
    typeof target !== 'object' || target === null ||
    typeof source !== 'object' || source === null ||
    Array.isArray(target) || Array.isArray(source)
  ) {
    return source;
  }
  const result: Record<string, unknown> = { ...(target as Record<string, unknown>) };
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    const cur = result[key];
    if (
      key in result && cur !== null && typeof cur === 'object' && !Array.isArray(cur) &&
      value !== null && typeof value === 'object' && !Array.isArray(value)
    ) {
      result[key] = deepMerge(cur, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

const mergeExecutor: LocalExecutor = async (node, ctx) => {
  const strategy = (node as { strategy?: 'shallow' | 'deep' }).strategy ?? 'shallow';
  const predecessors = Array.isArray(ctx.predecessors) ? ctx.predecessors : [];

  let merged: Record<string, JsonValue> = {};
  for (const predId of predecessors) {
    const predOutputs = ctx.varCtx.getNodeOutputs(predId);
    if (!predOutputs) continue;
    merged = strategy === 'deep'
      ? (deepMerge(merged, predOutputs) as Record<string, JsonValue>)
      : { ...merged, ...predOutputs };
  }
  return merged;
};

const setVariableExecutor: LocalExecutor = async (node, ctx) => {
  const output: NodeOutput = {};
  const assignments = (node as { assignments?: Array<{ key: string; value: string }> }).assignments ?? [];
  for (const { key, value } of assignments) {
    output[key] = typeof value === 'string' ? ctx.varCtx.ref(value) : (value as JsonValue);
  }
  return output;
};

const templateExecutor: LocalExecutor = async (node, ctx) => {
  const template = (node as { template?: string }).template ?? '';
  return { result: ctx.varCtx.interpolate(template) };
};

// ---------------- code（§10 P1-16 沙箱） ----------------

/**
 * 参数级 shadow 清单：网络 / DOM / 存储 / 进程 / 全局逃逸面，
 * 含 eval（直接求值）与 Function（间接求值入口）、arguments、constructor。
 * 与静态扫描（scanForbiddenIdentifiers 拒绝 constructor/__proto__/eval，
 * 字符串内出现亦拒）及 null 原型 inputs 三层叠加后，
 * §10 P1-16「禁 network/dom」实际可达；属性链之外的残余面仍归 Worker
 * TECH_DEBT 收敛。
 */
const DANGEROUS_IDENTIFIERS = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker', 'SharedWorker',
  'importScripts', 'require', 'module', 'exports', 'process', 'globalThis',
  'window', 'self', 'document', 'navigator', 'location', 'top', 'parent', 'frames',
  'localStorage', 'sessionStorage', 'indexedDB', 'caches',
  'alert', 'confirm', 'prompt', 'open',
  'setTimeout', 'setInterval', 'setImmediate', 'requestAnimationFrame',
  'Function', 'eval', 'arguments', 'constructor',
] as const;

/** P0：静态扫描命中项（禁用标识符即使出现在字符串/注释内也拒绝）。 */
export function scanForbiddenIdentifiers(code: string): string[] {
  const hits: string[] = [];
  const re = /\b(constructor|__proto__|eval)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    if (!hits.includes(m[1])) hits.push(m[1]);
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return hits;
}

/** 深冻结输入快照（防代码改写变量池数据；WeakSet 防环）。 */
function deepFreeze<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if (value !== null && typeof value === 'object' && !seen.has(value as object)) {
    seen.add(value as object);
    for (const key of Object.getOwnPropertyNames(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key], seen);
    }
    Object.freeze(value);
  }
  return value;
}

/** P0：重建为 null 原型对象树，封死经 inputs 的原型链访问。 */
function toNullProto<T>(value: T, seen: WeakMap<object, object> = new WeakMap()): T {
  if (Array.isArray(value)) {
    return value.map((v) => toNullProto(v, seen)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const cached = seen.get(value as object);
    if (cached) return cached as unknown as T;
    const out: Record<string, unknown> = Object.create(null);
    seen.set(value as object, out);
    for (const key of Object.getOwnPropertyNames(value as object)) {
      out[key] = toNullProto((value as Record<string, unknown>)[key], seen);
    }
    return out as unknown as T;
  }
  return value;
}

const codeExecutor: LocalExecutor = async (node, ctx) => {
  ensureNotAborted(ctx);
  const code = (node as { code?: string }).code ?? '';

  // P0 第一层：静态扫描（含字符串内出现即拒）
  const forbidden = scanForbiddenIdentifiers(code);
  if (forbidden.length > 0) {
    throw new Error(
      `节点 "${ctx.nodeId}" code 静态扫描拒绝：出现禁用标识符 [${forbidden.join(', ')}]`,
    );
  }

  // P0 第二层：null 原型 + 深冻结快照
  const inputs = deepFreeze(toNullProto(structuredClone(ctx.inputs ?? {})));
  try {
    // 结构说明：外层函数保持非严格（允许 eval 作参数名完成 shadow），
    // 用户代码置于带 "use strict" 的内层函数——赋值冻结对象抛 TypeError、
    // 禁止意外全局；自由变量经作用域链命中外层 undefined 影子参数。
    const wrapper = new Function(
      ...DANGEROUS_IDENTIFIERS,
      'inputs',
      'console',
      'Math',
      'JSON',
      'return function () {\n"use strict";\n' + code + '\n};',
    );
    const userFn = wrapper(
      ...DANGEROUS_IDENTIFIERS.map(() => undefined),
      inputs,
      console,
      Math,
      JSON,
    ) as () => unknown;
    const result: unknown = userFn();
    if (result !== null && typeof result === 'object' && !Array.isArray(result)) {
      return structuredClone(result) as NodeOutput;
    }
    return { result: structuredClone(result) as JsonValue };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`节点 "${ctx.nodeId}" code 执行失败: ${msg}`);
  }
};

// ---------------- iteration（§10 P1-16 内联子队列） ----------------

const DEFAULT_MAX_ITERATIONS = 500;

function resolveBodyNodes(body: unknown, nodeId: string): WorkflowNode[] {
  if (Array.isArray(body)) return body as WorkflowNode[];
  if (body !== null && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    if (Array.isArray(obj.nodes)) return obj.nodes as WorkflowNode[];
  }
  throw new Error(`iteration "${nodeId}": body 必须是节点数组或 { nodes } 对象`);
}

const iterationExecutor: LocalExecutor = async (node, ctx, dispatcher) => {
  ensureNotAborted(ctx);
  const overExpr = (node as { over?: string }).over ?? '';
  const overVal = ctx.varCtx.ref(overExpr);
  if (!Array.isArray(overVal)) {
    throw new Error(`iteration "${ctx.nodeId}": over "${overExpr}" 解析结果不是数组，实际为 ${typeof overVal}`);
  }
  const items = overVal as unknown[];
  const maxIter = (node as { maxIterations?: number }).maxIterations ?? DEFAULT_MAX_ITERATIONS;
  if (items.length > maxIter) {
    throw new Error(`iteration "${ctx.nodeId}": 迭代次数 ${items.length} 超过最大限制 ${maxIter}`);
  }
  const bodyNodes = resolveBodyNodes((node as { body?: unknown }).body, ctx.nodeId);

  const aggregated: NodeOutput[] = [];
  for (let index = 0; index < items.length; index++) {
    // ✕ 语义在子队列粒度的应用：中止后不再派发新的迭代，已完成迭代保留
    if (ctx.signal.aborted) {
      ctx.log(`[${ctx.nodeId}] 已中止，剩余 ${items.length - index} 次迭代不再派发`);
      break;
    }
    let lastOutput: NodeOutput = {};
    let iterInputs: Record<string, JsonValue> | undefined = { _item: items[index] as JsonValue, _index: index };
    for (const bodyNode of bodyNodes) {
      if (ctx.signal.aborted) {
        ctx.log(`[${ctx.nodeId}] 已中止，迭代 ${index} 的剩余 body 节点不再派发`);
        iterInputs = undefined;
        break;
      }
      const childCtx: ExecutorContext = { ...ctx, nodeId: bodyNode.id };
      lastOutput = await dispatcher(bodyNode, childCtx, iterInputs);
      iterInputs = undefined; // 后续 body 节点链式接收前一节点输出
    }
    aggregated.push(lastOutput);
  }

  return { items: aggregated as JsonValue[] };
};

// ---------------- 注册表 ----------------

export interface LocalExecutorRegistry {
  get(type: string): LocalExecutor | undefined;
}

export function createLocalExecutors(): LocalExecutorRegistry {
  const table: Record<string, LocalExecutor> = {
    start: startExecutor,
    end: endExecutor,
    if_else: ifElseExecutor,
    switch: switchExecutor,
    merge: mergeExecutor,
    set_variable: setVariableExecutor,
    template: templateExecutor,
    code: codeExecutor,
    iteration: iterationExecutor,
  };
  return {
    get(type: string): LocalExecutor | undefined {
      return table[type];
    },
  };
}
