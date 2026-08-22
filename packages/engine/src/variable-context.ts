import { Parser } from "expr-eval";
import { WorkflowVarError } from "./errors.js";

/** JSON 兼容值类型，与 IMPLEMENTATION_PLAN.md 契约对齐 */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/**
 * 单占位符正则：完整匹配 "{{#nodeId.prop}}" 或 "{{#nodeId.a.b.c}}"（嵌套路径）
 * 节点 id 必须匹配 ^[a-zA-Z_][a-zA-Z0-9_]*$（表达式变量名安全），
 * prop 路径允许点号分隔的多级访问。
 */
const PLACEHOLDER_RE = /^\{\{\#([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_.]*)\}\}$/;

/** 全局匹配版本，用于 interpolate 全量替换 */
const PLACEHOLDER_GLOBAL_RE = /\{\{\#([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_.]*)\}\}/g;

function isSinglePlaceholder(s: string): boolean {
  return PLACEHOLDER_RE.test(s);
}

function parsePlaceholder(
  s: string
): { nodeId: string; propPath: string } | null {
  const m = PLACEHOLDER_RE.exec(s);
  if (!m) return null;
  return { nodeId: m[1], propPath: m[2] };
}

/** 按点号路径从对象取值 */
function getPath(obj: Record<string, JsonValue>, path: string): JsonValue | undefined {
  const parts = path.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cur: any = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, JsonValue>)[p];
  }
  return cur as JsonValue | undefined;
}

/** 按点号路径检查属性是否存在 */
function hasPath(obj: Record<string, JsonValue>, path: string): boolean {
  const parts = path.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cur: any = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined || typeof cur !== "object") return false;
    if (!(p in cur)) return false;
    cur = (cur as Record<string, JsonValue>)[p];
  }
  return true;
}

/**
 * Run 级变量总线。
 *
 * 每次运行以 runId 独立实例化；并发多运行（Run）互不可见。
 * 同步 API：set / ref / evalExpr / interpolate。
 */
export class VariableContext {
  private store = new Map<string, Record<string, JsonValue>>();

  /**
   * 记录节点输出。
   * nodeId 必须与 WorkflowDSL 节点 id 一致（全图唯一）。
   */
  set(nodeId: string, outputs: Record<string, JsonValue>): void {
    this.store.set(nodeId, outputs);
  }

  /**
   * 直接引用：值恰为单个占位符 "{{#nodeId.prop}}" 时返回原始 JsonValue（保型）；
   * 此时若节点未输出 / 引用不存在的节点，抛 WorkflowVarError。
   * 非占位符字符串作为字面量原样返回。
   *
   * 链式解析（SetVariableNode ／ EndNode 变量引用链）时自动维护解析栈检测循环引用。
   */
  ref(template: string): JsonValue {
    if (!isSinglePlaceholder(template)) {
      return template; // 字面量直通
    }
    return this.resolveRef(template, []);
  }

  /**
   * 递归解析占位符链，stack 维护解析路径用于环检测。
   */
  private resolveRef(refStr: string, stack: string[]): JsonValue {
    if (stack.includes(refStr)) {
      throw new WorkflowVarError(
        refStr,
        `循环引用检测到: ${[...stack, refStr].join(" -> ")}`,
      );
    }

    const parsed = parsePlaceholder(refStr);
    if (!parsed) {
      return refStr; // 非占位符（不应发生在内部链中）
    }

    const { nodeId, propPath } = parsed;
    const outputs = this.store.get(nodeId);

    if (outputs === undefined) {
      throw new WorkflowVarError(
        refStr,
        `引用了不存在的节点 "${nodeId}"`,
      );
    }

    if (!hasPath(outputs, propPath)) {
      throw new WorkflowVarError(
        refStr,
        `节点 "${nodeId}" 未输出属性 "${propPath}"`,
      );
    }

    const value = getPath(outputs, propPath)!;

    // 链式解析：若值恰为单个占位符则继续递归
    if (typeof value === "string" && isSinglePlaceholder(value)) {
      return this.resolveRef(value, [...stack, refStr]);
    }

    return value;
  }

  /**
   * 表达式上下文求值。
   * vars 以节点 id 为变量名注入原始值；禁止文本拼接后求值。
   * 错误包装为带原始表达式的 Error。
   */
  evalExpr(expr: string): JsonValue {
    const vars: Record<string, Record<string, JsonValue>> = {};
    for (const [nodeId, outputs] of this.store) {
      vars[nodeId] = outputs;
    }
    try {
      return Parser.evaluate(expr, vars as any) as JsonValue;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `表达式求值失败，原始表达式: "${expr}"，错误: ${msg}`,
      );
    }
  }

  /**
   * 文本插值：占位符混排常量时使用。
   * 占位符替换规则：字符串值直出，非字符串值 JSON.stringify。
   * 占位符解析遵循与 ref 相同的链式解析 + 环检测规则。
   */
  interpolate(s: string): string {
    return s.replace(PLACEHOLDER_GLOBAL_RE, (match, nodeId: string, propPath: string) => {
      const refStr = `{{#${nodeId}.${propPath}}}`;
      const value = this.resolveRef(refStr, []);
      if (typeof value === "string") {
        return value;
      }
      return JSON.stringify(value);
    });
  }
}