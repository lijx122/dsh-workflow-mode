/**
 * library.ts 单测 (M4)：jsdom localStorage 真链路。
 * 覆盖任务书五项：CRUD 链路 / 播种仅一次 / importJson 坏 JSON 返 err /
 * 坏值备份与恢复 / exportJson 深度一致；另覆盖配额溢出静默 ok:false。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LIBRARY_BACKUP_KEY,
  LIBRARY_STORAGE_KEY,
  blankWorkflowDsl,
  createBlank,
  deleteWorkflow,
  duplicateWorkflow,
  exportJson,
  getActiveWorkflow,
  importJson,
  listWorkflows,
  loadLibrary,
  renameWorkflow,
  saveWorkflow,
  setActiveWorkflow,
} from './library.js';
import { SAMPLE_WORKFLOWS } from './templates.js';

function freshStorage(): Storage {
  window.localStorage.clear();
  return window.localStorage;
}

const seedIds = ['wf_seed_triage', 'wf_seed_summarizer', 'wf_seed_code_review'];

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('播种（§10 P1-12）', () => {
  it('空库首读：三个 templates 示例转默认库且激活第一条', () => {
    const store = freshStorage();
    expect(window.localStorage.getItem(LIBRARY_STORAGE_KEY)).toBeNull();

    const { snapshot, corrupted } = loadLibrary(store);
    expect(corrupted).toBe(false);
    expect(snapshot.workflows.map((w) => w.id)).toEqual(seedIds);
    expect(snapshot.activeId).toBe(seedIds[0]);
    // dsl 深拷贝自 SAMPLE_WORKFLOWS
    expect(snapshot.workflows[0]!.dsl).toEqual(SAMPLE_WORKFLOWS.triage);
    // 已持久化
    expect(window.localStorage.getItem(LIBRARY_STORAGE_KEY)).not.toBeNull();
  });

  it('播种仅一次：删光后重读不再回填模板', () => {
    const store = freshStorage();
    loadLibrary(store);
    for (const id of seedIds) {
      const r = deleteWorkflow(id, store);
      expect(r.ok).toBe(true);
    }
    expect(loadLibrary(store).snapshot.workflows).toEqual([]);
    expect(loadLibrary(store).snapshot.workflows).toEqual([]);
    expect(listWorkflows(store)).toEqual([]);
  });
});

describe('CRUD 链路', () => {
  it('新建 → 重命名 → 复制 → 删除 全链路 + 持久化往返', () => {
    const store = freshStorage();
    loadLibrary(store); // 先播种

    const created = createBlank('我的新流程', store);
    expect(created).toMatchObject({ ok: true });
    if (!created.ok) return;
    const newId = created.id;

    // 新建后为活动项，dsl 为 start→end 单边空白
    let active = getActiveWorkflow(store);
    expect(active?.id).toBe(newId);
    expect(active?.name).toBe('我的新流程');
    expect(active?.dsl.nodes.map((n) => n.type)).toEqual(['start', 'end']);
    expect(active?.dsl.edges).toHaveLength(1);

    // 校验器放行（schema 可用性回归）
    expect(active!.dsl.version).toBe('dsh.workflow.v1');

    // 重命名：改名不改 updatedAt 之外的任何结构
    expect(renameWorkflow(newId, '改名流程', store)).toMatchObject({ ok: true });
    active = getActiveWorkflow(store);
    expect(active?.name).toBe('改名流程');
    expect(active?.dsl.nodes).toHaveLength(2);

    // 空名拒绝
    expect(renameWorkflow(newId, '   ', store)).toMatchObject({ ok: false });

    // 复制：(副本) 名称 + 独立 id + 成为活动项
    const dup = duplicateWorkflow(newId, store);
    expect(dup).toMatchObject({ ok: true });
    if (!dup.ok) return;
    expect(dup.id).not.toBe(newId);
    let all = listWorkflows(store);
    expect(all.find((w) => w.id === dup.id)?.name).toBe('改名流程 (副本)');
    expect(getActiveWorkflow(store)?.id).toBe(dup.id);

    // 复制品 dsl 深独立：改原件不影响副本
    saveWorkflow(
      { id: newId, dsl: { ...blankWorkflowDsl(), nodes: [{ id: 'start_1', type: 'start', name: '开始', inputs: {} }] } as never },
      store,
    );
    all = listWorkflows(store);
    expect(all.find((w) => w.id === newId)!.dsl.nodes).toHaveLength(1);
    expect(all.find((w) => w.id === dup.id)!.dsl.nodes).toHaveLength(2);

    // 删除副本 → 活动指针顺移回原条目
    expect(deleteWorkflow(dup.id, store)).toMatchObject({ ok: true });
    expect(getActiveWorkflow(store)?.id).toBe(newId);

    // 刷新（重读）持久化一致
    expect(loadLibrary(store).snapshot.workflows.map((w) => w.id)).toContain(newId);

    // 不存在的 id
    expect(deleteWorkflow('wf_missing', store)).toMatchObject({ ok: false });
  });

  it('saveWorkflow 更新已有条目：保留 id、刷新 updatedAt、dsl 替换', async () => {
    const store = freshStorage();
    loadLibrary(store);
    const created = createBlank(undefined, store);
    if (!created.ok) throw new Error('createBlank failed');
    const before = listWorkflows(store).find((w) => w.id === created.id)!;
    await new Promise((r) => setTimeout(r, 5));
    const r = saveWorkflow({ id: created.id, name: undefined as unknown as string, dsl: blankWorkflowDsl('v2') }, store);
    expect(r).toMatchObject({ ok: true, id: created.id });
    const after = listWorkflows(store).find((w) => w.id === created.id)!;
    expect(after.name).toBe(before.name); // 未给名沿用原名
    expect(after.updatedAt).toBeGreaterThanOrEqual(before.updatedAt);
    expect(getActiveWorkflow(store)?.id).toBe(created.id);
  });

  it('setActiveWorkflow 切换活动指针', () => {
    const store = freshStorage();
    loadLibrary(store);
    expect(setActiveWorkflow(seedIds[2]!, store)).toMatchObject({ ok: true });
    expect(getActiveWorkflow(store)?.id).toBe(seedIds[2]);
    expect(setActiveWorkflow('nope', store)).toMatchObject({ ok: false });
  });
});

describe('importJson / exportJson', () => {
  it('exportJson → importJson 往返深度一致', () => {
    const store = freshStorage();
    loadLibrary(store);
    const text = exportJson(seedIds[0]!, store);
    expect(text).not.toBe('');
    const imported = importJson(text, store);
    expect(imported).toMatchObject({ ok: true });
    if (!imported.ok) return;
    const again = exportJson(imported.id, store);
    expect(JSON.parse(again)).toEqual(SAMPLE_WORKFLOWS.triage);
    // 导入件成为活动项
    expect(getActiveWorkflow(store)?.id).toBe(imported.id);
  });

  it('坏 JSON 返 err（invalid-json），合法但非法 DSL 返 invalid-dsl', () => {
    const store = freshStorage();
    loadLibrary(store);

    const bad = importJson('{ not valid json !!', store);
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.err.startsWith('invalid-json')).toBe(true);

    const nonDsl = importJson('{"hello":"world"}', store);
    expect(nonDsl.ok).toBe(false);
    if (nonDsl.ok) return;
    expect(nonDsl.err.startsWith('invalid-dsl')).toBe(true);

    expect(importJson('', store).ok).toBe(false);
    // 失败导入不污染库
    expect(listWorkflows(store)).toHaveLength(3);
  });
});

describe('健壮性（§10 P1-11）', () => {
  it('坏值：原样备份 .bak → 空库启动 + corrupted 标志', () => {
    const store = freshStorage();
    window.localStorage.setItem(LIBRARY_STORAGE_KEY, '{oops:: broken json');

    const { snapshot, corrupted } = loadLibrary(store);
    expect(corrupted).toBe(true);
    expect(snapshot).toEqual({ workflows: [], activeId: null });
    // 坏值已原样备份
    expect(window.localStorage.getItem(LIBRARY_BACKUP_KEY)).toBe('{oops:: broken json');
    // 主键已被空库覆写，下次读取不再报损坏
    expect(loadLibrary(store).corrupted).toBe(false);
    expect(loadLibrary(store).snapshot).toEqual({ workflows: [], activeId: null });
  });

  it('形状不对的值同样走备份自愈', () => {
    const store = freshStorage();
    window.localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify({ hello: 1 }));
    const { corrupted, snapshot } = loadLibrary(store);
    expect(corrupted).toBe(true);
    expect(snapshot.workflows).toEqual([]);
    expect(window.localStorage.getItem(LIBRARY_BACKUP_KEY)).toBe('{"hello":1}');
  });

  it('部分损坏条目剔除而非整库判死', () => {
    const store = freshStorage();
    loadLibrary(store);
    const raw = JSON.parse(window.localStorage.getItem(LIBRARY_STORAGE_KEY)!);
    raw.workflows.push({ id: '', name: 'x' }, 42, null);
    raw.activeId = 'ghost-id';
    window.localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(raw));
    const { corrupted, snapshot } = loadLibrary(store);
    expect(corrupted).toBe(false);
    expect(snapshot.workflows.map((w) => w.id)).toEqual(seedIds);
    expect(snapshot.activeId).toBe(seedIds[0]); // ghost 指针回退首条
  });

  it('写配额溢出：catch 静默 ok:false 且不抛错', () => {
    const memStore: Storage = {
      getLength: () => 0,
      key: () => null,
      clear: () => {},
      getItem: (_k: string) => null,
      setItem: () => {
        throw new DOMException('quota exceeded', 'QuotaExceededError');
      },
      removeItem: () => {},
    } as unknown as Storage;

    // 键缺席 → 播种写失败仍返回可用内存库
    const seeded = loadLibrary(memStore);
    expect(seeded.corrupted).toBe(false);
    expect(seeded.snapshot.workflows).toHaveLength(3);

    expect(createBlank('x', memStore)).toMatchObject({ ok: false });
    expect(saveWorkflow({ dsl: blankWorkflowDsl() }, memStore).ok).toBe(false);
    expect(renameWorkflow('a', 'b', memStore).ok).toBe(false);
    expect(deleteWorkflow(seedIds[0]!, memStore).ok).toBe(false);
    expect(duplicateWorkflow(seedIds[0]!, memStore).ok).toBe(false);
    expect(importJson(JSON.stringify(SAMPLE_WORKFLOWS.triage), memStore).ok).toBe(false);
  });
});
