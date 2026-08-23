/**
 * 工作流库工具条 (M4 · 设计文档 §6 工具栏「工作流下拉」控件)。
 *
 * - 下拉名单：当前活动项高亮（tint 三件套）；点击行切换活动工作流；
 *   每项悬浮操作：重命名 / 复制 / 导出下载 / 删除。
 * - 工具栏按钮：「＋新建」（createBlank 空白 start→end）、「导入」
 *   （隐藏 file input 读文本 → importJson）。
 * - 损坏提示（§10 P1-11）：loadLibrary 返回 corrupted=true 时弹 toast；
 *   导入/保存/删除失败同样以 toast 反馈，绝不静默吞掉。
 * - 导出：exportJson 文本 + Blob + a[download] 触发浏览器下载。
 * - 样式走 css modules，色值全部引用 tokens.css 语义变量。
 *
 * 集成约定：本组件自持库状态；宿主（studio 容器）通过 onActiveChange
 * 拿到当前活动工作流去渲染画布。组件挂载即读库（含播种/自愈）。
 */
import { ChangeEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { StoredWorkflow } from '../library.js';
import {
  createBlank,
  deleteWorkflow,
  duplicateWorkflow,
  exportJson,
  importJson,
  loadLibrary,
  renameWorkflow,
  setActiveWorkflow,
} from '../library.js';
import css from './library-ui.module.css';

export interface LibraryBarProps {
  /** 活动工作流变化时回调（选择/新建/导入/删除后都会触发）；库为空时为 undefined。 */
  onActiveChange?: (workflow: StoredWorkflow | undefined) => void;
  /** 追加在根节点上的宿主类名。 */
  className?: string;
}

interface Notice {
  kind: 'error' | 'success';
  text: string;
}

const cx = (...parts: Array<string | false | undefined>): string => parts.filter(Boolean).join(' ');

function formatUpdatedAt(ts: number): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function safeFileStem(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return cleaned.length > 0 ? cleaned : 'workflow';
}

function triggerDownload(fileName: string, jsonText: string): void {
  // jsdom 无 createObjectURL：包一层防御，测试环境点击导出仅提示不崩。
  try {
    const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  } catch (error) {
    console.error('[dsh-workflow] export download failed:', error);
  }
}

export function LibraryBar({ onActiveChange, className }: LibraryBarProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const noticeTimerRef = useRef<number | undefined>(undefined);

  const [items, setItems] = useState<StoredWorkflow[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [notice, setNotice] = useState<Notice | undefined>(undefined);

  /* 审查单必修项1：外点先提交草稿 + blur/pointerdown 双触发防抖。
   * ref 持有最新值/最新提交函数，供仅依赖 [menuOpen] 的 document 级监听器使用。 */
  const renamingIdRef = useRef<string | null>(null);
  const commitRenameRef = useRef<() => void>(() => {});
  /** 同一手势内已提交过一次的锁：挡下 pointerdown 提交后紧随的 blur 二次提交。 */
  const renameCommitLockRef = useRef(false);
  /** 重命名中按下另一行时置位：blur 提交后的同手势 click 不再当作切换选择。 */
  const suppressRowClickRef = useRef(false);

  const showNotice = useCallback((next: Notice) => {
    setNotice(next);
    if (noticeTimerRef.current !== undefined) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(undefined), 4000);
  }, []);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current !== undefined) window.clearTimeout(noticeTimerRef.current);
    };
  }, []);

  /** 重读库并回填状态；活动指针缺失时顺移到首条（§6 当前库名单语义）。 */
  const applyLoaded = useCallback(() => {
    const { snapshot, corrupted } = loadLibrary();
    let workflows = snapshot.workflows;
    let nextActive = snapshot.activeId;
    if ((nextActive === null || !workflows.some((w) => w.id === nextActive)) && workflows.length > 0) {
      nextActive = workflows[0]!.id;
      setActiveWorkflow(nextActive);
      workflows = loadLibrary().snapshot.workflows;
    }
    setItems(workflows);
    setActiveIdState(nextActive);
    if (corrupted) {
      showNotice({
        kind: 'error',
        text: '本地工作流库已损坏：原数据备份至 dsh.workflowStudio.v1.bak，本次以空库启动。',
      });
    }
  }, [showNotice]);

  useEffect(() => {
    applyLoaded();
  }, [applyLoaded]);

  // 活动项变化通知宿主（回调经 ref 保持最新，避免依赖抖动）。
  const onActiveChangeRef = useRef(onActiveChange);
  onActiveChangeRef.current = onActiveChange;
  useEffect(() => {
    onActiveChangeRef.current?.(items.find((w) => w.id === activeId));
  }, [items, activeId]);

  // 浮层外点/Esc 关闭。
  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (event: globalThis.MouseEvent): void => {
      // 每次按压开始都重置误触抑制位，防止上一次手势残留吞掉本次合法点击。
      suppressRowClickRef.current = false;
      if (
        rootRef.current &&
        event.target instanceof Node &&
        !rootRef.current.contains(event.target)
      ) {
        // 必修项1：菜单随 setMenuOpen(false) 同步卸载，input 的 blur 无从派发，
        // 因此外点时必须先经最新 ref 提交草稿，再关浮层；
        // performCommit 内部的 lock 会挡下随后可能到达的 blur 双触发。
        if (renamingIdRef.current !== null) commitRenameRef.current();
        setMenuOpen(false);
        return;
      }
      // 必修项1次要问题：重命名中按下「另一行」，blur 先提交、click 再切换
      // 属同一手势的双重动作——抑制该 click 的选择语义。
      if (renamingIdRef.current !== null && event.target instanceof Element) {
        const row = event.target.closest<HTMLElement>('[data-row]');
        if (row !== null && row.dataset.id !== renamingIdRef.current) {
          suppressRowClickRef.current = true;
        }
      }
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  const stopPropagation = useCallback((event: { stopPropagation(): void }): void => {
    event.stopPropagation();
  }, []);

  const handleSelect = useCallback(
    (item: StoredWorkflow): void => {
      if (renamingId !== null) return; // 重命名中不响应行切换
      if (suppressRowClickRef.current) {
        // 该 click 属于「按下导致 blur 提交」的同一手势，不作为切换（消费一次即失效）。
        suppressRowClickRef.current = false;
        return;
      }
      if (item.id !== activeId) {
        const result = setActiveWorkflow(item.id);
        if (!result.ok) {
          showNotice({ kind: 'error', text: `切换失败：${result.err}` });
          return;
        }
      }
      setMenuOpen(false);
      applyLoaded();
    },
    [activeId, renamingId, applyLoaded, showNotice],
  );

  const handleCreate = useCallback(() => {
    const result = createBlank(`未命名工作流 ${items.length + 1}`);
    if (!result.ok) {
      showNotice({ kind: 'error', text: `新建失败：${result.err}` });
      return;
    }
    setRenamingId(null);
    applyLoaded();
  }, [items.length, applyLoaded, showNotice]);

  const startRename = useCallback(
    (item: StoredWorkflow, event: { stopPropagation(): void }): void => {
      event.stopPropagation();
      setRenamingId(item.id);
      setDraftName(item.name);
    },
    [],
  );

  const cancelRename = useCallback((): void => {
    setRenamingId(null);
    setDraftName('');
  }, []);

  const commitRename = useCallback((): void => {
    // 外点路径已提交过时，紧随的 blur 到此即止（同一手势只提交一次）。
    if (renameCommitLockRef.current) return;
    const id = renamingId;
    if (id === null) return;
    renameCommitLockRef.current = true;
    window.setTimeout(() => {
      renameCommitLockRef.current = false;
    }, 0);
    const name = draftName.trim();
    setRenamingId(null);
    setDraftName('');
    if (name.length === 0) return; // 视为取消
    const result = renameWorkflow(id, name);
    if (!result.ok) {
      showNotice({ kind: 'error', text: `重命名失败：${result.err}` });
      return;
    }
    applyLoaded();
  }, [renamingId, draftName, applyLoaded, showNotice]);

  // 供 [menuOpen] 域监听器取用最新闭包（避免把高频状态挂进依赖数组）。
  renamingIdRef.current = renamingId;
  commitRenameRef.current = commitRename;

  const handleRenameKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>): void => {
      event.stopPropagation(); // Esc 只退出重命名，不关浮层
      if (event.key === 'Enter') commitRename();
      else if (event.key === 'Escape') cancelRename();
    },
    [commitRename, cancelRename],
  );

  const handleDuplicate = useCallback(
    (item: StoredWorkflow, event: { stopPropagation(): void }): void => {
      event.stopPropagation();
      const result = duplicateWorkflow(item.id);
      if (!result.ok) {
        showNotice({ kind: 'error', text: `复制失败：${result.err}` });
        return;
      }
      applyLoaded();
    },
    [applyLoaded, showNotice],
  );

  const handleExport = useCallback(
    (item: StoredWorkflow, event: { stopPropagation(): void }): void => {
      event.stopPropagation();
      const text = exportJson(item.id);
      if (text.length === 0) {
        showNotice({ kind: 'error', text: `导出失败：找不到「${item.name}」` });
        return;
      }
      triggerDownload(`${safeFileStem(item.name)}.json`, text);
    },
    [showNotice],
  );

  const handleDelete = useCallback(
    (item: StoredWorkflow, event: { stopPropagation(): void }): void => {
      event.stopPropagation();
      if (!window.confirm(`确定删除工作流「${item.name}」？该操作不可撤销。`)) return;
      const result = deleteWorkflow(item.id);
      if (!result.ok) {
        showNotice({ kind: 'error', text: `删除失败：${result.err}` });
        return;
      }
      applyLoaded();
    },
    [applyLoaded, showNotice],
  );

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleImportFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
      const input = event.currentTarget;
      const file = input.files?.[0];
      input.value = ''; // 允许重复导入同一文件
      if (!file) return;
      let text = '';
      try {
        text = await file.text();
      } catch {
        showNotice({ kind: 'error', text: '读取文件失败。' });
        return;
      }
      const result = importJson(text);
      if (!result.ok) {
        showNotice({ kind: 'error', text: `导入失败：${result.err}` });
        return;
      }
      applyLoaded();
      showNotice({ kind: 'success', text: '导入成功：已加入库名单并设为活动工作流。' });
    },
    [applyLoaded, showNotice],
  );

  const activeItem = items.find((w) => w.id === activeId) ?? undefined;

  return (
    <div ref={rootRef} className={cx(css.bar, className)}>
      <button
        type="button"
        className={css.trigger}
        title={activeItem ? activeItem.name : '选择工作流'}
        aria-haspopup="listbox"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <span className={css.triggerLabel}>{activeItem ? activeItem.name : '选择工作流…'}</span>
        <span className={css.caret}>▾</span>
      </button>

      <button type="button" className={css.btn} title="新建空白工作流" onClick={handleCreate}>
        ＋ 新建
      </button>
      <button type="button" className={css.btn} title="导入 JSON 工作流文件" onClick={handleImportClick}>
        ⬆ 导入
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={(event) => void handleImportFile(event)}
      />

      {menuOpen && (
        <div className={css.menu} role="listbox" aria-label="工作流名单">
          {items.length === 0 && <div className={css.empty}>库为空：点击「＋ 新建」开始</div>}
          {items.map((item) => (
            <div
              key={item.id}
              data-row
              data-id={item.id}
              role="option"
              tabIndex={0}
              aria-selected={item.id === activeId}
              className={cx(css.item, item.id === activeId && css.itemActive)}
              onClick={() => handleSelect(item)}
            >
              {renamingId === item.id ? (
                <input
                  autoFocus
                  className={css.renameInput}
                  value={draftName}
                  onClick={stopPropagation}
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={handleRenameKeyDown}
                  onBlur={commitRename}
                />
              ) : (
                <>
                  <span className={css.itemName}>{item.name}</span>
                  <span className={css.itemTime}>{formatUpdatedAt(item.updatedAt)}</span>
                  <span className={css.rowActions}>
                    <button type="button" className={css.actionBtn} title="重命名" aria-label="重命名" onClick={(e) => startRename(item, e)}>✏️</button>
                    <button type="button" className={css.actionBtn} title="复制" aria-label="复制" onClick={(e) => handleDuplicate(item, e)}>⧉</button>
                    <button type="button" className={css.actionBtn} title="导出 JSON" aria-label="导出 JSON" onClick={(e) => handleExport(item, e)}>⬇</button>
                    <button type="button" className={cx(css.actionBtn, css.danger)} title="删除" aria-label="删除" onClick={(e) => handleDelete(item, e)}>🗑</button>
                  </span>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {notice && (
        <div
          className={cx(css.notice, notice.kind === 'error' ? css.noticeError : css.noticeSuccess)}
          role="status"
        >
          <span>{notice.text}</span>
          <button type="button" className={css.noticeClose} aria-label="关闭提示" onClick={() => setNotice(undefined)}>
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

export default LibraryBar;
