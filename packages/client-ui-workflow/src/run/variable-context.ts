/**
 * Run 级变量总线（M3 浏览器侧最小实现）。
 *
 * ⚠ 复用说明：语义与 @dsh-workflow/engine 的 VariableContext 一一对齐
 * （packages/engine/src/variable-context.ts：占位符正则、链式解析+环检测、
 * interpolate 的 stringify 规则、evalExpr 的 vars 注入方式全部照抄）。
 * 未直接 import 复用的原因：client-ui-workflow 的 package.json 未声明
 * @dsh-workflow/engine / expr-eval 依赖，而 package.json 不在本模块文件
 * 所有权内——已作为「集成冲突」上报 Director；依赖补齐后本文件应替换为
 * 对 engine 包的 re-export。
 *
 * evalExpr 使用 expr-eval 方言的最小子集解析器（and/or/not、比较、四则、
 * 成员访问），与 IMPLEMENTATION_PLAN.md T3 裁决一致。
 */

/** JSON 兼容值（与 engine 契约对齐）。 */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/** 占位符语法错误（对齐 engine WorkflowVarError 形状）。 */
export class WorkflowVarError extends Error {
  readonly ref: string;
  constructor(ref: string, message: string) {
    super(message);
    this.name = 'WorkflowVarError';
    this.ref = ref;
  }
}

/**
 * 单占位符正则：完整匹配 "{{#nodeId.prop}}" 或 "{{#nodeId.a.b.c}}"。
 * 与 engine 逐字相同（id 匹配 ^[a-zA-Z_][a-zA-Z0-9_]*$）。
 */
const PLACEHOLDER_RE = /^\{\{#([a-zA-Z_][a-zA-Z0-9_]*)\.((?:\w+)(?:\.\w+)*)\}\}$/;

/** 宽松定位用全局版本（interpolate 回调内再严格校验）。 */
const PLACEHOLDER_GLOBAL_RE = /\{\{#([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z0-9_.]*)\}\}/g;

function isSinglePlaceholder(s: string): boolean {
  return PLACEHOLDER_RE.test(s);
}

function parsePlaceholder(s: string): { nodeId: string; propPath: string } | null {
  const m = PLACEHOLDER_RE.exec(s);
  if (!m) return null;
  return { nodeId: m[1], propPath: m[2] };
}

/** 按点号路径取值（只走 own property，阻断原型链穿透）。 */
function getPath(obj: Record<string, JsonValue>, path: string): JsonValue | undefined {
  let cur: unknown = obj;
  for (const p of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    if (!Object.hasOwn(cur as Record<string, unknown>, p)) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur as JsonValue | undefined;
}

function hasPath(obj: Record<string, JsonValue>, path: string): boolean {
  let cur: unknown = obj;
  for (const p of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return false;
    if (!Object.hasOwn(cur as Record<string, unknown>, p)) return false;
    cur = (cur as Record<string, unknown>)[p];
  }
  return true;
}

// ================= 表达式求值（expr-eval 最小子集） =================

type Token =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'ident'; v: string }
  | { t: 'op'; v: string };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i;
      while (j < src.length && /[0-9.eE]/.test(src[j])) j++;
      // 科学计数法符号位
      if ((src[j] === '+' || src[j] === '-') && /[eE]/.test(src[j - 1] ?? '')) { j++; while (j < src.length && /[0-9]/.test(src[j])) j++; }
      const num = Number(src.slice(i, j));
      if (!Number.isFinite(num)) {
        throw new Error(`非法数字字面量 "${src.slice(i, j)}"`);
      }
      tokens.push({ t: 'num', v: num });
      i = j;
      continue;
    }
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      let out = '';
      while (j < src.length && src[j] !== ch) {
        if (src[j] === '\\' && j + 1 < src.length) { out += src[j + 1]; j += 2; continue; }
        out += src[j];
        j++;
      }
      if (j >= src.length) throw new Error('字符串字面量未闭合');
      tokens.push({ t: 'str', v: out });
      i = j + 1;
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[a-zA-Z0-9_]/.test(src[j])) j++;
      tokens.push({ t: 'ident', v: src.slice(i, j) });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['==', '!=', '<=', '>=', '&&', '||'].includes(two)) {
      tokens.push({ t: 'op', v: two });
      i += 2;
      continue;
    }
    if ('+-*/%()<>!,.?'.includes(ch)) {
      tokens.push({ t: 'op', v: ch });
      i++;
      continue;
    }
    throw new Error(`无法识别的字符 "${ch}"`);
  }
  return tokens;
}

function truthy(v: unknown): boolean {
  return Array.isArray(v) ? v.length > 0 : Boolean(v);
}

class ExprEvaluator {
  private pos = 0;
  constructor(
    private readonly tokens: Token[],
    private readonly vars: Record<string, Record<string, JsonValue>>,
  ) {}

  evaluate(): JsonValue {
    const value = this.parseOr();
    if (this.pos < this.tokens.length) {
      const rest = this.tokens[this.pos];
      // 三元显式报错（方言裁决 REVISE P1-1：选择「明确报错」而非实现）
      if (rest.t === 'op' && rest.v === '?') {
        throw new Error('不支持三元运算符（?:）：请改用 and/or/not 组合，或移步 code 节点实现分支');
      }
      throw new Error(`表达式存在未消费的尾部 token`);
    }
    return value;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private eatOp(v: string): boolean {
    const tok = this.peek();
    if (tok && tok.t === 'op' && tok.v === v) { this.pos++; return true; }
    return false;
  }

  private eatIdent(v: string): boolean {
    const tok = this.peek();
    if (tok && tok.t === 'ident' && tok.v === v) { this.pos++; return true; }
    return false;
  }

  private parseOr(): JsonValue {
    let left = this.parseAnd();
    for (;;) {
      const isOr = this.eatOp('||');
      if (!isOr) {
        // 词法层面 or 已作为 ident 出现，仅在其后不是比较对象时按逻辑符消费
        const tok = this.peek();
        if (!(tok && tok.t === 'ident' && tok.v === 'or')) break;
        this.pos++;
      }
      const right = this.parseAnd();
      // 短路值语义：命中真值即返回该值（与 expr-eval 布尔判定兼容）
      left = truthy(left) ? left : right;
    }
    return left;
  }

  private parseAnd(): JsonValue {
    let left = this.parseNot();
    for (;;) {
      const isAnd = this.eatOp('&&');
      if (!isAnd) {
        const tok = this.peek();
        if (!(tok && tok.t === 'ident' && tok.v === 'and')) break;
        this.pos++;
      }
      const right = this.parseNot();
      left = truthy(left) ? right : left;
    }
    return left;
  }

  private parseNot(): JsonValue {
    if (this.eatOp('!') || this.eatIdent('not')) {
      const value = this.parseNot();
      return !value;
    }
    return this.parseComparison();
  }

  private parseComparison(): JsonValue {
    let left = this.parseAdditive();
    for (;;) {
      // 方言裁决（REVISE P1-1）：== / != 采用严格相等语义（跨型即不等）
      if (this.eatOp('==')) { left = left === this.parseAdditive(); continue; }
      if (this.eatOp('!=')) { left = left !== this.parseAdditive(); continue; }
      if (this.eatOp('<=')) { left = Number(left) <= Number(this.parseAdditive()); continue; }
      if (this.eatOp('>=')) { left = Number(left) >= Number(this.parseAdditive()); continue; }
      if (this.eatOp('<')) { left = Number(left) < Number(this.parseAdditive()); continue; }
      if (this.eatOp('>')) { left = Number(left) > Number(this.parseAdditive()); continue; }
      return left;
    }
  }

  private parseAdditive(): JsonValue {
    let left = this.parseMultiplicative();
    for (;;) {
      if (this.eatOp('+')) {
        // 方言裁决（REVISE P1-1）：对齐 expr-eval 数值加法——非数值不做拼接，
        // 经 Number() 归一后 NaN 即传播
        const r = this.parseMultiplicative();
        const ln = Number(left);
        const rn = Number(r);
        left = Number.isNaN(ln) || Number.isNaN(rn) ? NaN : ln + rn;
        continue;
      }
      if (this.eatOp('-')) { left = Number(left) - Number(this.parseMultiplicative()); continue; }
      return left;
    }
  }

  private parseMultiplicative(): JsonValue {
    let left = this.parseUnary();
    for (;;) {
      if (this.eatOp('*')) { left = Number(left) * Number(this.parseUnary()); continue; }
      if (this.eatOp('/')) { left = Number(left) / Number(this.parseUnary()); continue; }
      if (this.eatOp('%')) { left = Number(left) % Number(this.parseUnary()); continue; }
      return left;
    }
  }

  private parseUnary(): JsonValue {
    if (this.eatOp('-')) return -Number(this.parseUnary());
    return this.parsePrimary();
  }

  private parsePrimary(): JsonValue {
    const tok = this.peek();
    if (!tok) throw new Error('表达式意外结束');
    if (tok.t === 'num') { this.pos++; return tok.v; }
    if (tok.t === 'str') { this.pos++; return tok.v; }
    if (tok.t === 'op' && tok.v === '(') {
      this.pos++;
      const inner = this.parseOr();
      if (!this.eatOp(')')) throw new Error('缺少右括号');
      return inner;
    }
    if (tok.t === 'ident') {
      this.pos++;
      if (tok.v === 'true') return true;
      if (tok.v === 'false') return false;
      if (tok.v === 'null') return null;
      // 函数调用显式报错（方言裁决 REVISE P1-1：选择「明确报错」而非实现）
      const nextTok = this.peek();
      if (nextTok && nextTok.t === 'op' && nextTok.v === '(') {
        throw new Error(`不支持函数调用 "${tok.v}(...)"：表达式求值器不提供内置函数，请在 code 节点实现`);
      }
      let base: unknown = this.vars[tok.v];
      if (base === undefined) {
        throw new Error(`未知变量 "${tok.v}"`);
      }
      // 成员访问链 a.b.c（每步走 own property）
      while (this.eatOp('.')) {
        const prop = this.peek();
        if (!prop || prop.t !== 'ident') throw new Error('成员访问后应为标识符');
        this.pos++;
        if (base === null || typeof base !== 'object') {
          throw new Error(`属性 "${prop.v}" 访问于非对象值`);
        }
        if (!Object.hasOwn(base as Record<string, unknown>, prop.v)) {
          throw new Error(`对象不存在属性 "${prop.v}"`);
        }
        base = (base as Record<string, unknown>)[prop.v];
      }
      return base as JsonValue;
    }
    throw new Error(`意外的 token "${tok.t === 'op' ? tok.v : String((tok as { v: unknown }).v)}"`);
  }
}

// ================= 变量总线 =================

/**
 * Run 级变量总线（浏览器版）。API 与 engine.VariableContext 同名同义：
 * set / getNodeOutputs / hasNode / ref / evalExpr / interpolate。
 */
export class VariableContext {
  private store = new Map<string, Record<string, JsonValue>>();

  set(nodeId: string, outputs: Record<string, JsonValue>): void {
    this.store.set(nodeId, outputs);
  }

  getNodeOutputs(nodeId: string): Record<string, JsonValue> | undefined {
    return this.store.get(nodeId);
  }

  hasNode(nodeId: string): boolean {
    return this.store.has(nodeId);
  }

  /** 直接引用：恰为单个占位符时保型返回原始 JsonValue，否则字面量直通。 */
  ref(template: string): JsonValue {
    if (!isSinglePlaceholder(template)) return template;
    return this.resolveRef(template, []);
  }

  private resolveRef(refStr: string, stack: string[]): JsonValue {
    if (stack.includes(refStr)) {
      throw new WorkflowVarError(refStr, `循环引用检测到: ${[...stack, refStr].join(' -> ')}`);
    }
    const parsed = parsePlaceholder(refStr);
    if (!parsed) return refStr;
    const { nodeId, propPath } = parsed;
    const outputs = this.store.get(nodeId);
    if (outputs === undefined) {
      throw new WorkflowVarError(refStr, `引用了不存在的节点 "${nodeId}"`);
    }
    if (!hasPath(outputs, propPath)) {
      throw new WorkflowVarError(refStr, `节点 "${nodeId}" 未输出属性 "${propPath}"`);
    }
    const value = getPath(outputs, propPath);
    if (value === undefined) {
      throw new WorkflowVarError(refStr, `节点 "${nodeId}" 属性 "${propPath}" 的值为 undefined（非法 JsonValue）`);
    }
    if (typeof value === 'string' && isSinglePlaceholder(value)) {
      return this.resolveRef(value, [...stack, refStr]);
    }
    return value;
  }

  /** 表达式上下文求值：vars 以节点 id 为变量名注入原始值。 */
  evalExpr(expr: string): JsonValue {
    try {
      const vars: Record<string, Record<string, JsonValue>> = {};
      for (const [nodeId, outputs] of this.store) vars[nodeId] = outputs;
      return new ExprEvaluator(tokenize(expr), vars).evaluate();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`表达式求值失败，原始表达式: "${expr}"，错误: ${msg}`);
    }
  }

  /** 文本插值：占位符字符串直出，非字符串 JSON.stringify。 */
  interpolate(s: string): string {
    return s.replace(PLACEHOLDER_GLOBAL_RE, (match) => {
      if (!parsePlaceholder(match)) {
        throw new WorkflowVarError(match, `非法占位符 "${match}"`);
      }
      const value = this.resolveRef(match, []);
      if (typeof value === 'string') return value;
      return JSON.stringify(value);
    });
  }
}
