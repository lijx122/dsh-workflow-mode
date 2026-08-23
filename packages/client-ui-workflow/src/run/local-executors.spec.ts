/**
 * M3 单测：本地执行器 + 变量总线（表达式/占位符）。
 */
import { describe, it, expect } from 'vitest';
import type { WorkflowNode } from '@dsh-workflow/schema';
import { VariableContext, WorkflowVarError } from './variable-context.js';
import {
  AbortedError,
  createLocalExecutors,
  type ExecutorContext,
  type NodeOutput,
} from './local-executors.js';

function n(partial: Record<string, unknown>): WorkflowNode {
  return partial as unknown as WorkflowNode;
}

const signal = new AbortController().signal;

function ctx(overrides: Partial<ExecutorContext> = {}): ExecutorContext {
  return {
    runId: 'r1',
    nodeId: 'n1',
    signal,
    log: () => {},
    varCtx: new VariableContext(),
    ...overrides,
  };
}

// 兜底 dispatcher：body 内不应被触达（本文件不含会话节点）
const failingDispatcher = async (): Promise<NodeOutput> => {
  throw new Error('unexpected dispatcher call');
};

describe('VariableContext', () => {
  it('ref：单个占位符保型返回，非占位符字面量直通', () => {
    const v = new VariableContext();
    v.set('a', { count: 3, flag: true });
    expect(v.ref('{{#a.count}}')).toBe(3);
    expect(v.ref('{{#a.flag}}')).toBe(true);
    expect(v.ref('plain text')).toBe('plain text');
  });

  it('ref：嵌套路径与链式解析', () => {
    const v = new VariableContext();
    v.set('a', { obj: { deep: 'x' } });
    v.set('b', { alias: '{{#a.obj.deep}}' });
    expect(v.ref('{{#a.obj.deep}}')).toBe('x');
    expect(v.ref('{{#b.alias}}')).toBe('x');
  });

  it('ref：缺失节点 / 缺失属性 / 循环引用均抛 WorkflowVarError', () => {
    const v = new VariableContext();
    v.set('loop', { self: '{{#loop.self}}' });
    expect(() => v.ref('{{#ghost.x}}')).toThrow(WorkflowVarError);
    expect(() => v.ref('{{#a.nope}}')).toThrow(WorkflowVarError);
    expect(() => v.ref('{{#loop.self}}')).toThrow(/循环引用/);
  });

  it('interpolate：混排替换，非字符串 JSON.stringify', () => {
    const v = new VariableContext();
    v.set('s', { name: 'DSH' });
    v.set('o', { arr: [1, 2] });
    expect(v.interpolate('hello {{#s.name}}!')).toBe('hello DSH!');
    expect(v.interpolate('items={{#o.arr}}')).toBe('items=[1,2]');
    expect(() => v.interpolate('{{#s..bad}}')).toThrow(WorkflowVarError);
  });

  it('evalExpr：成员访问、比较、and/or/not、四则与括号（expr-eval 方言）', () => {
    const v = new VariableContext();
    v.set('audit', { result: { riskLevel: 'HIGH' } });
    v.set('nums', { a: 5, b: 2 });
    expect(v.evalExpr("audit.result.riskLevel == 'HIGH'")).toBe(true);
    expect(v.evalExpr("audit.result.riskLevel != 'LOW'")).toBe(true);
    expect(v.evalExpr('nums.a > nums.b and nums.b > 0')).toBe(true);
    expect(v.evalExpr('nums.a < nums.b or false')).toBe(false);
    expect(v.evalExpr('not (nums.a < nums.b)')).toBe(true);
    expect(v.evalExpr('(nums.a + nums.b) * 2')).toBe(14);
    expect(v.evalExpr('nums.a % nums.b')).toBe(1);
    // 短路值语义
    expect(v.evalExpr('nums.a or nums.b')).toBe(5);
  });

  it('evalExpr：未知变量与语法错误包装原始表达式信息', () => {
    const v = new VariableContext();
    expect(() => v.evalExpr('ghost.x == 1')).toThrow(/ghost/);
    expect(() => v.evalExpr('(1 + ')).toThrow(/表达式求值失败/);
  });
});

describe('本地执行器', () => {
  const registry = createLocalExecutors();

  it('start：提取声明参数的 default 值', async () => {
    const out = await registry.get('start')!(
      n({ id: 'start', type: 'start', inputs: { env: { type: 'string', default: 'prod' }, missing: { type: 'number' } } }),
      ctx(),
      failingDispatcher,
    );
    expect(out).toEqual({ env: 'prod' });
  });

  it('end：outputs 引用经 ref 解析收集', async () => {
    const c = ctx();
    c.varCtx.set('t', { result: 'R' });
    const out = await registry.get('end')!(
      n({ id: 'e', type: 'end', outputs: { report: '{{#t.result}}', status: 'ok' } }),
      c,
      failingDispatcher,
    );
    expect(out).toEqual({ report: 'R', status: 'ok' });
  });

  it('if_else：truthy → true 分支，falsy → false 分支', async () => {
    const c = ctx();
    c.varCtx.set('v', { x: 10 });
    expect(
      (await registry.get('if_else')!(n({ id: 'i', type: 'if_else', condition: 'v.x > 5' }), c, failingDispatcher)).branch,
    ).toBe('true');
    expect(
      (await registry.get('if_else')!(n({ id: 'i', type: 'if_else', condition: 'v.x > 50' }), c, failingDispatcher)).branch,
    ).toBe('false');
  });

  it('switch：when 条件命中；未命中回退 defaultCase', async () => {
    const c = ctx();
    c.varCtx.set('env', { name: 'staging' });
    const node = n({
      id: 'sw',
      type: 'switch',
      cases: [
        { when: "env.name == 'production'", value: 'deploy' },
        { when: "env.name == 'staging'", value: 'preview' },
      ],
      defaultCase: 'default',
    });
    expect((await registry.get('switch')!(node, c, failingDispatcher)).branch).toBe('preview');
    const miss = n({
      id: 'sw',
      type: 'switch',
      cases: [{ when: 'false', value: 'never' }],
      defaultCase: 'fallback',
    });
    expect((await registry.get('switch')!(miss, c, failingDispatcher)).branch).toBe('fallback');
  });

  it('merge：shallow 与 deep 聚合前驱输出', async () => {
    const c = ctx({ predecessors: ['p1', 'p2'] });
    c.varCtx.set('p1', { a: 1, nested: { x: 1 } });
    c.varCtx.set('p2', { b: 2, nested: { y: 2 } });
    const shallow = await registry.get('merge')!(n({ id: 'm', type: 'merge' }), c, failingDispatcher);
    expect(shallow).toEqual({ a: 1, nested: { y: 2 }, b: 2 });
    const deep = await registry.get('merge')!(n({ id: 'm', type: 'merge', strategy: 'deep' }), c, failingDispatcher);
    expect(deep).toEqual({ a: 1, b: 2, nested: { x: 1, y: 2 } });
  });

  it('set_variable：占位符保型写入，输出即键值对', async () => {
    const c = ctx();
    c.varCtx.set('src', { list: [1, 2, 3] });
    const out = await registry.get('set_variable')!(
      n({ id: 'sv', type: 'set_variable', assignments: [{ key: 'items', value: '{{#src.list}}' }, { key: 'label', value: 'L' }] }),
      c,
      failingDispatcher,
    );
    expect(out).toEqual({ items: [1, 2, 3], label: 'L' });
  });

  it('template：全模板插值输出 { result }', async () => {
    const c = ctx();
    c.varCtx.set('who', { name: '小电' });
    const out = await registry.get('template')!(
      n({ id: 'tp', type: 'template', template: '# {{#who.name}} 交付' }),
      c,
      failingDispatcher,
    );
    expect(out.result).toBe('# 小电 交付');
  });

  it('code：函数体执行，对象原样返回、标量包 { result }', async () => {
    const c = ctx({ inputs: { diff: '+a\n-b' } });
    const obj = await registry.get('code')!(
      n({ id: 'c1', type: 'code', code: 'return { lines: inputs.diff.split("\\n").length };' }),
      c,
      failingDispatcher,
    );
    expect(obj).toEqual({ lines: 2 });
    const scalar = await registry.get('code')!(
      n({ id: 'c2', type: 'code', code: 'return 42;' }),
      ctx(),
      failingDispatcher,
    );
    expect(scalar).toEqual({ result: 42 });
  });

  it('code：网络/DOM 标识符被 shadow，白名单 console/Math/JSON 可用', async () => {
    const out = await registry.get('code')!(
      n({
        id: 'c3',
        type: 'code',
        code: 'return { fetch: typeof fetch, doc: typeof document, fn: typeof Function, j: JSON.stringify([Math.round(1.9)]) };',
      }),
      ctx(),
      failingDispatcher,
    );
    expect(out).toEqual({ fetch: 'undefined', doc: 'undefined', fn: 'undefined', j: '[2]' });
  });

  it('code：inputs 深冻结，改写抛 TypeError 并包装错误信息', async () => {
    await expect(
      registry.get('code')!(
        n({ id: 'c4', type: 'code', code: '"use strict"; inputs.v = 9; return {};', inputs: undefined }),
        ctx({ inputs: { v: 1 } }),
        failingDispatcher,
      ),
    ).rejects.toThrow(/code 执行失败/);
  });

  it('iteration：内联子队列串行循环，聚合 items；_item/_index 注入首节点', async () => {
    const c = ctx();
    c.varCtx.set('start', { files: ['a.csv', 'b.txt', 'c.json'] });
    const body = [n({ id: 'wash', type: 'code', code: 'return { name: inputs._item, idx: inputs._index };' })];
    const out = await registry.get('iteration')!(
      n({ id: 'it', type: 'iteration', over: '{{#start.files}}', body }),
      c,
      async (bn, _c, ov) => registry.get('code')!(bn, { ...c, nodeId: bn.id, inputs: ov }, failingDispatcher),
    );
    expect(out.items).toEqual([
      { name: 'a.csv', idx: 0 },
      { name: 'b.txt', idx: 1 },
      { name: 'c.json', idx: 2 },
    ]);
  });

  it('iteration：over 非数组与超 maxIterations 抛错', async () => {
    const c = ctx();
    c.varCtx.set('s', { notArray: 'x' });
    await expect(
      registry.get('iteration')!(n({ id: 'it', type: 'iteration', over: '{{#s.notArray}}', body: [] }), c, failingDispatcher),
    ).rejects.toThrow(/不是数组/);
    c.varCtx.set('big', { arr: new Array(4).fill(0) });
    await expect(
      registry.get('iteration')!(
        n({ id: 'it', type: 'iteration', over: '{{#big.arr}}', maxIterations: 3, body: [] }),
        c,
        failingDispatcher,
      ),
    ).rejects.toThrow(/超过最大限制/);
  });

  it('iteration：已中止信号在派发前抛 AbortedError', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const c = ctx({ signal: ctrl.signal });
    c.varCtx.set('s', { arr: [1] });
    await expect(
      registry.get('iteration')!(
        n({ id: 'it', type: 'iteration', over: '{{#s.arr}}', body: [n({ id: 'b', type: 'code', code: 'return {};' })] }),
        c,
        failingDispatcher,
      ),
    ).rejects.toBeInstanceOf(AbortedError);
  });

  it('未知类型查不到执行器', () => {
    expect(registry.get('llm')).toBeUndefined();
    expect(registry.get('http_request')).toBeUndefined();
  });
});
