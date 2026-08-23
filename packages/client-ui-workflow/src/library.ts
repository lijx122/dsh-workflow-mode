/**
 * 工作流库与持久化 (M4 · 设计文档 §6 / §10 裁决 P1-11、P1-12)。
 *
 * - 存储键唯一：localStorage["dsh.workflowStudio.v1"]，数据形状
 *   { workflows: [{ id, name, dsl, updatedAt }], activeId }；
 *   键读写集中收口在内部 readRaw()/writeSnapshot() 两处。
 * - 默认播种（P1-12）：仅当主键完全不存在时，把 templates.ts 三个示例
 *   转入默认库一次；之后用户删光也不再重新播种（有持久化痕迹即视为已初始化）。
 * - 读失败策略（P1-11）：try/catch → 坏值原样备份到 ".bak" 键 →
 *   空库启动，并返回 corrupted 标志供 UI toast 提示。
 * - 写失败策略：setItem 配额溢出/隐私模式异常一律 catch → 返回
 *   ok:false 静默降级，绝不向上抛错。
 * - 所有 API 支持注入 Storage（对齐 M1 studio-layout 风格），便于 jsdom 单测；
 *   未注入时取全局 localStorage。
 */

import { validateWorkflow } from '@dsh-workflow/schema';
import { SAMPLE_WORKFLOWS } from './templates.js';
import type { WorkflowDSL } from './types.js';

/** 工作流库主存储键（§6）。 */
export const LIBRARY_STORAGE_KEY = 'dsh.workflowStudio.v1';
/** 坏值备份键（§10 P1-11）。 */
export const LIBRARY_BACKUP_KEY = `${LIBRARY_STORAGE_KEY}.bak`;

/** 库内单条工作流记录。 */
export interface StoredWorkflow {
  id: string;
  name: string;
  dsl: WorkflowDSL;
  /** 最后更新时间戳（ms）。 */
  updatedAt: number;
}

/** 持久化快照形状（§6）。 */
export interface LibrarySnapshot {
  workflows: StoredWorkflow[];
  activeId: string | null;
}

/** 读取结果；corrupted = true 表示检测到坏值且已按 §10.11 自愈。 */
export interface LibraryLoadResult {
  snapshot: LibrarySnapshot;
  corrupted: boolean;
}

export type LibraryResult = { ok: true } | { ok: false; err: string };
export type LibraryIdResult = { ok: true; id: string } | { ok: false; err: string };

export interface SaveWorkflowInput {
  /** 命中已有记录则更新；缺省或未命中的 id 一律视为新建（保留给定 id）。 */
  id?: string;
  /** 覆盖显示名；缺省沿用原名 / dsl.name /「未命名工作流」。 */
  name?: string;
  dsl: WorkflowDSL;
  /** 保存后是否置为活动工作流，默认 true。 */
  makeActive?: boolean;
}

/* ==================== 内部：键读写集中收口 ==================== */

function defaultStorage(): Storage | undefined {
  try {
    if (typeof localStorage === 'undefined') return undefined;
    return localStorage;
  } catch {
    return undefined;
  }
}

type RawRead = { kind: 'absent' } | { kind: 'unreadable' } | { kind: 'raw'; text: string };

/** 主键唯一读取口。absent = 键不存在；unreadable = getItem 本身抛错（隐私模式等）。 */
function readRaw(store: Storage | undefined): RawRead {
  if (!store) return { kind: 'absent' };
  let text: string | null;
  try {
    text = store.getItem(LIBRARY_STORAGE_KEY);
  } catch {
    return { kind: 'unreadable' };
  }
  return text === null ? { kind: 'absent' } : { kind: 'raw', text };
}

/** 主键唯一写入口。配额溢出等异常静默降级为 ok:false（§通用健壮性）。 */
function writeSnapshot(snapshot: LibrarySnapshot, store: Storage | undefined): LibraryResult {
  if (!store) return { ok: false, err: 'storage-unavailable' };
  try {
    store.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(snapshot));
    return { ok: true };
  } catch {
    return { ok: false, err: 'storage-write-failed' };
  }
}

function emptySnapshot(): LibrarySnapshot {
  return { workflows: [], activeId: null };
}

function cloneDsl(dsl: WorkflowDSL): WorkflowDSL {
  return JSON.parse(JSON.stringify(dsl)) as WorkflowDSL;
}

function displayNameOf(dsl: WorkflowDSL, fallback = '未命名工作流'): string {
  const name = (dsl as { name?: unknown }).name;
  return typeof name === 'string' && name.trim().length > 0 ? name.trim() : fallback;
}

let idSeq = 0;
function newWorkflowId(): string {
  idSeq = (idSeq + 1) % 1296;
  return `wf_${Date.now().toString(36)}${idSeq.toString(36).padStart(2, '0')}${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

/** 单条记录防御式矫正：结构不合格的条目直接丢弃（不算整库损坏）。 */
function coerceWorkflow(entry: unknown): StoredWorkflow | undefined {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
  const rec = entry as Record<string, unknown>;
  if (typeof rec.id !== 'string' || rec.id.length === 0) return undefined;
  if (typeof rec.name !== 'string') return undefined;
  const dsl = rec.dsl;
  if (dsl === null || typeof dsl !== 'object' || Array.isArray(dsl)) return undefined;
  const d = dsl as Record<string, unknown>;
  if (!Array.isArray(d.nodes) || !Array.isArray(d.edges)) return undefined;
  const updatedAt =
    typeof rec.updatedAt === 'number' && Number.isFinite(rec.updatedAt) ? rec.updatedAt : Date.now();
  return { id: rec.id, name: rec.name, dsl: dsl as WorkflowDSL, updatedAt };
}

function parseStored(text: string): { kind: 'ok'; snapshot: LibrarySnapshot } | { kind: 'corrupt' } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: 'corrupt' };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { kind: 'corrupt' };
  }
  const workflowsRaw = (parsed as { workflows?: unknown }).workflows;
  if (!Array.isArray(workflowsRaw)) return { kind: 'corrupt' };
  const workflows: StoredWorkflow[] = [];
  for (const entry of workflowsRaw) {
    const coerced = coerceWorkflow(entry);
    if (coerced !== undefined) workflows.push(coerced);
  }
  const activeRaw = (parsed as { activeId?: unknown }).activeId;
  const activeId =
    typeof activeRaw === 'string' && workflows.some((w) => w.id === activeRaw)
      ? activeRaw
      : workflows[0]?.id ?? null;
  return { kind: 'ok', snapshot: { workflows, activeId } };
}

/** P1-12：三个内置示例转默认库（稳定 id，仅初始化时调用）。 */
function buildSeedSnapshot(): LibrarySnapshot {
  const now = Date.now();
  const workflows: StoredWorkflow[] = Object.keys(SAMPLE_WORKFLOWS).map((key) => {
    const dsl = cloneDsl(SAMPLE_WORKFLOWS[key]);
    return {
      id: `wf_seed_${key}`,
      name: displayNameOf(dsl, key),
      dsl,
      updatedAt: now,
    };
  });
  return { workflows, activeId: workflows[0]?.id ?? null };
}

/* ==================== 公共 API ==================== */

/**
 * 库读取总入口：负责播种（键缺席时一次）与坏值自愈（§10.11）。
 * 其余 API 内部统一经此读，再经 writeSnapshot 写。
 */
export function loadLibrary(store: Storage | undefined = defaultStorage()): LibraryLoadResult {
  const raw = readRaw(store);
  if (raw.kind === 'absent') {
    const seeded = buildSeedSnapshot();
    writeSnapshot(seeded, store); // 播种写失败不影响本次内存可用性
    return { snapshot: seeded, corrupted: false };
  }
  if (raw.kind === 'unreadable') {
    // 无法读取也就无从备份：按损坏上报，但不得伪造 .bak 内容。
    return { snapshot: emptySnapshot(), corrupted: true };
  }
  const parsed = parseStored(raw.text);
  if (parsed.kind === 'ok') {
    return { snapshot: parsed.snapshot, corrupted: false };
  }
  try {
    store?.setItem(LIBRARY_BACKUP_KEY, raw.text);
  } catch {
    /* 备份失败不阻塞空库启动 */
  }
  writeSnapshot(emptySnapshot(), store);
  return { snapshot: emptySnapshot(), corrupted: true };
}

/** 列出全部工作流（保持插入序）。 */
export function listWorkflows(store: Storage | undefined = defaultStorage()): StoredWorkflow[] {
  return loadLibrary(store).snapshot.workflows;
}

/** 取当前活动工作流；无活动项或指向缺失时回退首条。 */
export function getActiveWorkflow(
  store: Storage | undefined = defaultStorage(),
): StoredWorkflow | undefined {
  const { snapshot } = loadLibrary(store);
  return (
    snapshot.workflows.find((w) => w.id === snapshot.activeId) ?? snapshot.workflows[0] ?? undefined
  );
}

/** 新建/更新的统一落点（另存=不带 id 调用；重命名走 renameWorkflow）。 */
export function saveWorkflow(
  input: SaveWorkflowInput,
  store: Storage | undefined = defaultStorage(),
): LibraryIdResult {
  const { snapshot } = loadLibrary(store);
  const now = Date.now();
  const dsl = cloneDsl(input.dsl);
  const idx = input.id !== undefined ? snapshot.workflows.findIndex((w) => w.id === input.id) : -1;

  if (idx >= 0) {
    const prev = snapshot.workflows[idx];
    const nextName =
      input.name !== undefined && input.name.trim().length > 0 ? input.name.trim() : prev.name;
    snapshot.workflows[idx] = { ...prev, name: nextName, dsl, updatedAt: now };
    if (input.makeActive !== false) snapshot.activeId = prev.id;
    const written = writeSnapshot(snapshot, store);
    return written.ok ? { ok: true, id: prev.id } : { ok: false, err: written.err };
  }

  const id = input.id !== undefined && input.id.length > 0 ? input.id : newWorkflowId();
  const entry: StoredWorkflow = {
    id,
    name: input.name !== undefined && input.name.trim().length > 0 ? input.name.trim() : displayNameOf(input.dsl),
    dsl,
    updatedAt: now,
  };
  snapshot.workflows.push(entry);
  if (input.makeActive !== false) snapshot.activeId = id;
  const written = writeSnapshot(snapshot, store);
  return written.ok ? { ok: true, id } : { ok: false, err: written.err };
}

/** 重命名（不改 dsl）。 */
export function renameWorkflow(
  id: string,
  name: string,
  store: Storage | undefined = defaultStorage(),
): LibraryResult {
  const trimmed = name.trim();
  if (trimmed.length === 0) return { ok: false, err: '名称不能为空' };
  const { snapshot } = loadLibrary(store);
  const target = snapshot.workflows.find((w) => w.id === id);
  if (!target) return { ok: false, err: 'workflow-not-found' };
  target.name = trimmed;
  target.updatedAt = Date.now();
  const written = writeSnapshot(snapshot, store);
  return written.ok ? { ok: true } : { ok: false, err: written.err };
}

/** 删除；删除活动项时活动指针顺移到相邻条目（后优先，无则 null）。 */
export function deleteWorkflow(
  id: string,
  store: Storage | undefined = defaultStorage(),
): LibraryResult {
  const { snapshot } = loadLibrary(store);
  const idx = snapshot.workflows.findIndex((w) => w.id === id);
  if (idx < 0) return { ok: false, err: 'workflow-not-found' };
  if (snapshot.activeId === id) {
    const neighbor = snapshot.workflows[idx + 1] ?? snapshot.workflows[idx - 1] ?? undefined;
    snapshot.activeId = neighbor ? neighbor.id : null;
  }
  snapshot.workflows.splice(idx, 1);
  const written = writeSnapshot(snapshot, store);
  return written.ok ? { ok: true } : { ok: false, err: written.err };
}

/** 复制：深拷贝 dsl，名称加「(副本)」，插入原位之后并置为活动。 */
export function duplicateWorkflow(
  id: string,
  store: Storage | undefined = defaultStorage(),
): LibraryIdResult {
  const { snapshot } = loadLibrary(store);
  const idx = snapshot.workflows.findIndex((w) => w.id === id);
  if (idx < 0) return { ok: false, err: 'workflow-not-found' };
  const source = snapshot.workflows[idx];
  const copy: StoredWorkflow = {
    id: newWorkflowId(),
    name: `${source.name} (副本)`,
    dsl: cloneDsl(source.dsl),
    updatedAt: Date.now(),
  };
  snapshot.workflows.splice(idx + 1, 0, copy);
  snapshot.activeId = copy.id;
  const written = writeSnapshot(snapshot, store);
  return written.ok ? { ok: true, id: copy.id } : { ok: false, err: written.err };
}

/** 空白工作流 DSL：start → end 单边连通（§6「新建」模板）。 */
export function blankWorkflowDsl(name = '未命名工作流'): WorkflowDSL {
  return {
    version: 'dsh.workflow.v1',
    name,
    nodes: [
      { id: 'start_1', type: 'start', name: '开始', inputs: {} },
      { id: 'end_1', type: 'end', name: '结束', outputs: {} },
    ],
    edges: [{ id: 'edge_start_end', source: 'start_1', target: 'end_1' }],
  };
}

/** 新建空白工作流入库并激活。 */
export function createBlank(
  name?: string,
  store: Storage | undefined = defaultStorage(),
): LibraryIdResult {
  return saveWorkflow({ dsl: blankWorkflowDsl(name) }, store);
}

/** 切换活动工作流。 */
export function setActiveWorkflow(
  id: string,
  store: Storage | undefined = defaultStorage(),
): LibraryResult {
  const { snapshot } = loadLibrary(store);
  if (!snapshot.workflows.some((w) => w.id === id)) return { ok: false, err: 'workflow-not-found' };
  snapshot.activeId = id;
  const written = writeSnapshot(snapshot, store);
  return written.ok ? { ok: true } : { ok: false, err: written.err };
}

/**
 * 导入 dsh.workflow.v1 同构 JSON（§6：可直接被引擎热加载目录消费）。
 * 解析失败返 invalid-json；结构校验（@dsh-workflow/schema validateWorkflow）
 * 不过返 invalid-dsl；成功则入库并激活。
 */
export function importJson(
  text: string,
  store: Storage | undefined = defaultStorage(),
): LibraryIdResult {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { ok: false, err: '导入内容为空' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      err: `invalid-json: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const validation = validateWorkflow(parsed);
  if (!validation.ok) {
    const detail = validation.errors
      .slice(0, 3)
      .map((e) => `${e.path}: ${e.message}`)
      .join('；');
    return { ok: false, err: `invalid-dsl${detail ? `: ${detail}` : ''}` };
  }
  const { snapshot } = loadLibrary(store);
  const entry: StoredWorkflow = {
    id: newWorkflowId(),
    name: displayNameOf(parsed as WorkflowDSL, '导入的工作流'),
    dsl: cloneDsl(parsed as WorkflowDSL),
    updatedAt: Date.now(),
  };
  snapshot.workflows.push(entry);
  snapshot.activeId = entry.id;
  const written = writeSnapshot(snapshot, store);
  return written.ok ? { ok: true, id: entry.id } : { ok: false, err: written.err };
}

/**
 * 导出为格式化 JSON 字符串（与 dsh.workflow.v1 同构）；id 不存在返回空串，
 * 由 UI 层决定提示方式——本模块不弹窗、不抛错。
 */
export function exportJson(id: string, store: Storage | undefined = defaultStorage()): string {
  const { snapshot } = loadLibrary(store);
  const found = snapshot.workflows.find((w) => w.id === id);
  return found ? JSON.stringify(found.dsl, null, 2) : '';
}
