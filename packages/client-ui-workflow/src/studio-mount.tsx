/**
 * Studio view mounting (M1 rewrite, §2.1 / §10 P0-4 / P1-5 / P1-6 / P1-10 / P2-19).
 *
 * 结构：
 * - 容器 div[data-dsh-workflow-view] 挂在 centerCol 内部；
 * - 会话区域与工作流面板横向并存（三栏布局），左边缘带可拖拽 Resizable Splitter；
 * - MutationObserver 双层自愈 + subscribeStudioOpen 实时响应开关切换。
 */
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { StudioCanvas } from './canvas-parts/studio-canvas.js';
import { NODE_REGISTRY } from './nodes/registry.js';
import {
  loadLibrary,
  saveWorkflow,
  duplicateWorkflow,
  deleteWorkflow,
  setActiveWorkflow,
  type StoredWorkflow,
} from './library.js';
import type { WorkflowDSL, NodeStateInfo, WorkflowNode } from './types.js';
import type { NodeType } from '@dsh-workflow/schema';
import { BlockSelector } from './block-selector.js';
import {
  clampPanelWidth,
  loadLayoutMemory,
  resolveInitialLayout,
  saveLayoutMemory,
} from './studio-layout.js';
import './styles/tokens.css';

export const WORKFLOW_VIEW_SELECTOR = '[data-dsh-workflow-view]';

interface DswViewContainer extends HTMLDivElement {
  __dswWorkflowRoot?: Root;
}
const CENTER_COLUMN_SELECTOR = '[data-pane="conversation"], [class*="centerCol"]';
const ACTIVE_ATTR = 'data-dsh-workflow-active';

/* ---------------- 激活态管理 ---------------- */

let isStudioOpen = false;
let activeSessionId: string | undefined;

const openListeners = new Set<() => void>();

// 社区插件（任务看板、SSH 面板）互斥监听：一旦其他面板被激活，工作台自动收起
if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
  const siblingPanelObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes') {
        if (
          document.documentElement.hasAttribute('data-dsh-taskboard-active') ||
          document.documentElement.hasAttribute('data-dsh-ssh-active')
        ) {
          if (isStudioOpen) {
            isStudioOpen = false;
            applyActiveAttr();
          }
        }
      }
    }
  });
  try {
    siblingPanelObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-dsh-taskboard-active', 'data-dsh-ssh-active'],
    });
  } catch { /* noop in non-browser env */ }
}

export function subscribeStudioOpen(listener: () => void): () => void {
  openListeners.add(listener);
  return () => {
    openListeners.delete(listener);
  };
}

function emitOpenChange(): void {
  for (const listener of [...openListeners]) {
    try {
      listener();
    } catch (error) {
      console.error('[dsh-workflow] open listener error:', error);
    }
  }
}

function applyActiveAttr(): void {
  if (typeof document === 'undefined') return;
  if (isStudioOpen) document.documentElement.setAttribute(ACTIVE_ATTR, '');
  else document.documentElement.removeAttribute(ACTIVE_ATTR);
  emitOpenChange();
}

export function syncStudioGate(gate: { shouldShow: boolean; activeSessionId: string | undefined }): void {
  if (gate.activeSessionId !== activeSessionId) {
    activeSessionId = gate.activeSessionId;
  }
  applyActiveAttr();
}

export function openStudio(): void {
  // 排他互斥：打开工作流面板时，主动关闭任务看板与 SSH 面板
  if (typeof document !== 'undefined') {
    document.documentElement.removeAttribute('data-dsh-taskboard-active');
    document.documentElement.removeAttribute('data-dsh-ssh-active');
    const tbEntry = document.querySelector('[data-dsh-taskboard-entry]');
    if (tbEntry) delete (tbEntry as HTMLElement).dataset.active;
    const sshEntry = document.querySelector('[data-dsh-ssh-entry]');
    if (sshEntry) delete (sshEntry as HTMLElement).dataset.active;
  }
  isStudioOpen = true;
  applyActiveAttr();
}

export function closeWorkflowStudio(): void {
  isStudioOpen = false;
  applyActiveAttr();
}

export function toggleWorkflowStudio(): void {
  if (isStudioOpen) closeWorkflowStudio();
  else openStudio();
}

export function isStudioOpenNow(): boolean {
  return isStudioOpen;
}

/* ---------------- 视图组件 ---------------- */

interface StudioViewProps {
  initialCenterBasis: number;
  initialPanelWidth: number;
}

const StudioView: React.FC<StudioViewProps> = ({ initialCenterBasis, initialPanelWidth }) => {
  const [panelWidth, setPanelWidth] = React.useState(initialPanelWidth);
  const [draggingProp, setDraggingProp] = React.useState(false);
  const panelWidthRef = React.useRef(panelWidth);
  panelWidthRef.current = panelWidth;

  const [workflowWidth, setWorkflowWidth] = React.useState(() => {
    try {
      const stored = loadLayoutMemory();
      if (stored?.centerBasis && stored.centerBasis >= 420) return stored.centerBasis;
    } catch { /* noop */ }
    return Math.max(500, Math.min(900, Math.round(window.innerWidth * 0.58)));
  });
  const workflowWidthRef = React.useRef(workflowWidth);
  workflowWidthRef.current = workflowWidth;

  React.useEffect(() => {
    document.documentElement.style.setProperty('--dsw-workflow-width', `${workflowWidth}px`);
  }, [workflowWidth]);

  // 中栏会话与工作台之间的左侧主分隔条拖拽
  const onMainSplitterPointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    document.body.classList.add('dsw-col-resizing');
    const startX = event.clientX;
    const startWidth = workflowWidthRef.current;

    const onMove = (moveEvent: PointerEvent): void => {
      const delta = startX - moveEvent.clientX;
      const minW = 420;
      const maxW = Math.max(minW, window.innerWidth - 320);
      const nextW = Math.max(minW, Math.min(maxW, startWidth + delta));
      setWorkflowWidth(nextW);
      saveLayoutMemory({ centerBasis: nextW, panelWidth: panelWidthRef.current });
    };

    const finish = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      document.body.classList.remove('dsw-col-resizing');
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }, []);

  // 画布与右侧属性面板之间的内部属性分隔条拖拽
  const onPropSplitterPointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDraggingProp(true);
    document.body.classList.add('dsw-col-resizing');
    const startX = event.clientX;
    const startWidth = panelWidthRef.current;

    const onMove = (moveEvent: PointerEvent): void => {
      setPanelWidth(clampPanelWidth(startWidth + (startX - moveEvent.clientX), window.innerWidth));
    };
    const finish = (upEvent: PointerEvent): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      const finalWidth = clampPanelWidth(startWidth + (startX - upEvent.clientX), window.innerWidth);
      setPanelWidth(finalWidth);
      saveLayoutMemory({ centerBasis: workflowWidthRef.current, panelWidth: finalWidth });
      setDraggingProp(false);
      document.body.classList.remove('dsw-col-resizing');
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }, []);

  const [library, setLibrary] = React.useState(() => loadLibrary());
  const [activeId, setActiveId] = React.useState(library.snapshot.activeId);
  const activeWf: StoredWorkflow | undefined = React.useMemo(
    () => library.snapshot.workflows.find((w) => w.id === activeId) ?? library.snapshot.workflows[0],
    [library, activeId],
  );
  const dsl: WorkflowDSL = activeWf?.dsl ?? { version: 'dsh.workflow.v1', name: '空白工作流', nodes: [], edges: [] };

  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null);
  const [nodeStates, setNodeStates] = React.useState<Record<string, NodeStateInfo>>({});
  const [blockSelectorOpen, setBlockSelectorOpen] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [logs, setLogs] = React.useState<string[]>(['[System] 工作流 Studio 已就绪']);

  const selectedNode: WorkflowNode | undefined = React.useMemo(
    () => dsl.nodes.find((n) => n.id === selectedNodeId),
    [dsl.nodes, selectedNodeId],
  );
  const SelectedPanel = selectedNode
    ? NODE_REGISTRY.get(selectedNode.type)?.PanelComponent
    : undefined;

  const handleSelectWorkflow = (wf: StoredWorkflow): void => {
    setActiveId(wf.id);
    setActiveWorkflow(wf.id);
    setSelectedNodeId(null);
  };

  const handleDslChange = React.useCallback((nextDsl: WorkflowDSL): void => {
    if (!activeWf) return;
    saveWorkflow({ id: activeWf.id, dsl: nextDsl });
    setLibrary(loadLibrary());
  }, [activeWf]);

  const handleCreateNewWorkflow = (): void => {
    const defaultDsl: WorkflowDSL = {
      version: 'dsh.workflow.v1',
      name: `自定义工作流 ${library.snapshot.workflows.length + 1}`,
      nodes: [
        { id: 'start_1', type: 'start', name: '开始', inputs: {} },
        { id: 'end_1', type: 'end', name: '结束', inputs: {} },
      ],
      edges: [{ id: 'e_start_end', source: 'start_1', target: 'end_1' }],
    };
    const res = saveWorkflow({ name: defaultDsl.name, dsl: defaultDsl, makeActive: true });
    if (res.ok) {
      setLibrary(loadLibrary());
      setActiveId(res.id);
      setSelectedNodeId(null);
    }
  };

  const handleDuplicateActive = (): void => {
    if (!activeWf) return;
    const res = duplicateWorkflow(activeWf.id);
    if (res.ok) {
      setLibrary(loadLibrary());
      setActiveId(res.id);
    }
  };

  const handleDeleteActive = (): void => {
    if (!activeWf) return;
    if (library.snapshot.workflows.length <= 1) {
      alert('至少保留一份工作流');
      return;
    }
    if (confirm(`确认删除工作流 "${activeWf.name}" 吗？`)) {
      deleteWorkflow(activeWf.id);
      const nextLib = loadLibrary();
      setLibrary(nextLib);
      setActiveId(nextLib.snapshot.activeId);
      setSelectedNodeId(null);
    }
  };

  const handleAddNode = (type: NodeType): void => {
    const def = NODE_REGISTRY.get(type);
    const id = `n_${type}_${Date.now().toString(36).slice(4)}`;
    const defaultNode = def ? def.defaultFactory(id) : undefined;
    const newNode = {
      id,
      type,
      name: def?.label ?? type,
      inputs: defaultNode ? (defaultNode as { inputs?: unknown }).inputs ?? {} : {},
      position: {
        x: Math.round(150 + Math.random() * 180),
        y: Math.round(100 + Math.random() * 150),
      },
    } as unknown as WorkflowNode;
    const nextDsl: WorkflowDSL = {
      ...dsl,
      nodes: [...dsl.nodes, newNode],
    };
    handleDslChange(nextDsl);
    setSelectedNodeId(id);
    setLogs((prev) => [...prev, `[Node] 新增节点: ${newNode.name} (${type})`]);
  };

  const handleDeleteSelectedNode = (): void => {
    if (!selectedNodeId) return;
    const nextNodes = dsl.nodes.filter((n) => n.id !== selectedNodeId);
    const nextEdges = dsl.edges.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId);
    handleDslChange({ ...dsl, nodes: nextNodes, edges: nextEdges });
    setSelectedNodeId(null);
    setLogs((prev) => [...prev, `[Node] 已删除节点: ${selectedNodeId}`]);
  };

  const handleRunWorkflow = async (): Promise<void> => {
    if (running) return;
    setRunning(true);
    setLogs((prev) => [...prev, `[Run] 开始执行工作流: ${dsl.name} (共 ${dsl.nodes.length} 个节点)`]);
    
    const initStates: Record<string, NodeStateInfo> = {};
    for (const n of dsl.nodes) {
      initStates[n.id] = { status: 'pending' };
    }
    setNodeStates(initStates);

    try {
      for (const node of dsl.nodes) {
        setNodeStates((prev) => ({ ...prev, [node.id]: { status: 'running' } }));
        setLogs((prev) => [...prev, `[Running] 节点 ${node.name} (${node.type}) 运行中...`]);
        await new Promise((r) => setTimeout(r, 450));
        setNodeStates((prev) => ({
          ...prev,
          [node.id]: { status: 'completed', outputs: { result: 'ok' } },
        }));
        setLogs((prev) => [...prev, `[Success] 节点 ${node.name} 执行完成`]);
      }
      setLogs((prev) => [...prev, '[Completed] 工作流全流程执行成功 ✓']);
    } catch (err) {
      setLogs((prev) => [...prev, `[Error] 执行中断: ${String(err)}`]);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'row', height: '100%', width: '100%', position: 'relative' }}>
      {/* 1. 左缘主分隔条：按住可调节中间会话列与右侧工作台宽度分配 */}
      <div
        className="dsw-splitter dsw-left-splitter"
        role="separator"
        aria-orientation="vertical"
        title="按住向左/右拖拽，自由调整会话页面与工作流面板宽度"
        onPointerDown={onMainSplitterPointerDown}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 8,
          zIndex: 50,
          cursor: 'col-resize',
          background: 'transparent',
        }}
      >
        <div className="dsw-splitter-handle" style={{ height: 48, background: 'var(--dsw-alias-border-l2)' }} />
      </div>

      {/* 2. 工作台主体内容 */}
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', minWidth: 0, paddingLeft: 6 }}>
        {/* 顶部工具栏 */}
        <div className="dsw-view-toolbar">
          <div className="dsw-toolbar-left">
            <div className="dsw-app-title">⚡ 工作流 Studio</div>
            <span className="dsw-mode-badge">Dify 架构</span>
            <select
              className="dsw-workflow-select"
              value={activeWf?.id ?? ''}
              onChange={(e) => {
                const wf = library.snapshot.workflows.find((w) => w.id === e.target.value);
                if (wf) handleSelectWorkflow(wf);
              }}
              aria-label="选择工作流"
              style={{
                height: 28,
                padding: '0 8px',
                borderRadius: 6,
                border: '1px solid var(--dsw-alias-border-l2)',
                background: 'var(--dsw-alias-bg-layer-2)',
                color: 'var(--dsw-alias-label-primary)',
                fontSize: 12,
              }}
            >
              {library.snapshot.workflows.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
            <button
              type="button"
              className="dsw-btn-icon"
              onClick={handleCreateNewWorkflow}
              title="新建空白工作流"
              style={{ width: 'auto', padding: '0 8px', height: 28, fontSize: 12 }}
            >
              + 新建
            </button>
            <button
              type="button"
              className="dsw-btn-icon"
              onClick={() => setBlockSelectorOpen((v) => !v)}
              title="添加节点"
              style={{ width: 'auto', padding: '0 8px', height: 28, fontSize: 12, background: 'var(--tint-bg)', color: 'var(--tint-text)', borderColor: 'var(--tint-border)' }}
            >
              + 节点
            </button>
            <button
              type="button"
              className="dsw-btn-icon"
              onClick={handleDuplicateActive}
              title="复制当前工作流"
              style={{ width: 'auto', padding: '0 8px', height: 28, fontSize: 12 }}
            >
              复制
            </button>
            <button
              type="button"
              className="dsw-btn-icon"
              onClick={handleDeleteActive}
              title="删除当前工作流"
              style={{ width: 'auto', padding: '0 8px', height: 28, fontSize: 12 }}
            >
              删除
            </button>
          </div>

          <div className="dsw-toolbar-right">
            <button
              type="button"
              onClick={handleRunWorkflow}
              disabled={running}
              style={{
                height: 28,
                padding: '0 12px',
                borderRadius: 6,
                background: 'var(--dsw-alias-state-business-primary)',
                color: 'var(--on-brand)',
                border: 'none',
                cursor: running ? 'not-allowed' : 'pointer',
                fontWeight: 600,
                fontSize: 12,
              }}
            >
              {running ? '⏳ 运行中...' : '▶ 运行'}
            </button>
            <button type="button" className="dsw-btn-icon" onClick={closeWorkflowStudio} title="关闭工作流面板（恢复会话全宽）" aria-label="关闭工作台">✕</button>
          </div>
        </div>

        {/* 主体：画布 | 属性分隔条 | 属性面板 */}
        <div className="dsw-view-main" style={{ position: 'relative' }}>
          {/* 添加节点弹出选择器 */}
          <BlockSelector
            open={blockSelectorOpen}
            onSelect={handleAddNode}
            onClose={() => setBlockSelectorOpen(false)}
            style={{ position: 'absolute', top: 12, left: 16, zIndex: 70 }}
          />

          {/* 画布区 */}
          <div
            className="dsw-view-canvas"
            data-testid="workflow-studio-canvas"
            style={{ flex: 1, minWidth: 0, height: '100%', position: 'relative' }}
          >
            <StudioCanvas
              dsl={dsl}
              nodeStates={nodeStates}
              selectedNodeId={selectedNodeId}
              onSelect={setSelectedNodeId}
              onDslChange={handleDslChange}
            />
          </div>

          {/* 属性面板分隔条 */}
          <div
            className={draggingProp ? 'dsw-splitter is-dragging' : 'dsw-splitter'}
            role="separator"
            aria-orientation="vertical"
            title="拖拽调整属性面板宽度"
            onPointerDown={onPropSplitterPointerDown}
          >
            <div className="dsw-splitter-handle" />
          </div>

          {/* 属性配置面板 */}
          <aside className="dsw-prop-panel" data-testid="workflow-studio-panel" style={{ width: panelWidth }}>
            <div className="dsw-prop-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="dsw-prop-title">🔧 节点配置</span>
                {selectedNode && <span className="dsw-mode-badge">{String(selectedNode.type)}</span>}
              </div>
              {selectedNode && (
                <button
                  type="button"
                  onClick={handleDeleteSelectedNode}
                  title="删除当前选中的节点"
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--dsw-alias-state-error-primary)',
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  🗑️ 删除节点
                </button>
              )}
            </div>
            <div className="dsw-prop-body">
              {SelectedPanel && selectedNode ? (
                <SelectedPanel
                  node={selectedNode}
                  onChange={(patch) => {
                    if (!activeWf) return;
                    const nextDsl: WorkflowDSL = {
                      ...dsl,
                      nodes: dsl.nodes.map((n) =>
                        n.id === selectedNode.id ? ({ ...n, ...patch } as WorkflowNode) : n,
                      ),
                    };
                    handleDslChange(nextDsl);
                  }}
                />
              ) : (
                <p className="dsw-prop-placeholder">
                  未选中节点。在左侧画布中点击任意节点以编辑其属性与模型参数，或点击顶部「+ 节点」新增节点。
                </p>
              )}
            </div>
          </aside>
        </div>

        {/* 底部日志状态栏 */}
        <div className="dsw-view-footer" style={{ height: 32, fontSize: 11 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, overflow: 'hidden', whiteSpace: 'nowrap' }}>
            <span className="dsw-footer-status">● {running ? '正在执行...' : '就绪'}</span>
            <span style={{ opacity: 0.75 }}>{logs[logs.length - 1] ?? ''}</span>
          </div>
          <span style={{ opacity: 0.5 }}>节点数: {dsl.nodes.length} | 连线数: {dsl.edges.length}</span>
        </div>
      </div>
    </div>
  );
};

/* ---------------- 挂载 / 双层自愈 ---------------- */

export interface StudioGateInput {
  shouldShow: boolean;
  activeSessionId: string | undefined;
}

export interface MountController {
  isOpen: () => boolean;
  handleGate: (gate: StudioGateInput) => void;
  dispose: () => void;
}

export function mountStudio(): MountController {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  let rendered = false;
  let rootObserver: MutationObserver | undefined;

  const renderIfOpen = (): void => {
    if (container === undefined || root === undefined) return;
    if (isStudioOpen) {
      const column = container.parentElement;
      const measured =
        typeof column?.getBoundingClientRect === 'function'
          ? column.getBoundingClientRect().width
          : 0;
      const originalColumnWidth = measured > 0 ? measured : window.innerWidth * 0.42;
      const layout = resolveInitialLayout({
        originalColumnWidth,
        viewportWidth: window.innerWidth,
        stored: loadLayoutMemory(),
      });
      root.render(
        <StudioView
          key="studio-view"
          initialCenterBasis={layout.centerBasis}
          initialPanelWidth={layout.panelWidth}
        />,
      );
      rendered = true;
    } else if (!isStudioOpen && rendered) {
      root.render(null);
      rendered = false;
    }
  };

  const ensureContainer = (): void => {
    if (typeof document === 'undefined') return;
    if (container !== undefined && !container.isConnected) {
      try {
        root?.unmount();
      } catch (error) {
        console.error('[dsh-workflow] stale root unmount failed:', error);
      }
      root = undefined;
      rendered = false;
      container = undefined;
      rootObserver?.disconnect();
      rootObserver = undefined;
    }
    if (container === undefined) {
      const existing = document.querySelector<HTMLElement>(WORKFLOW_VIEW_SELECTOR);
      if (existing !== null) {
        container = existing as HTMLDivElement;
        const orphanRoot = (container as DswViewContainer).__dswWorkflowRoot;
        if (orphanRoot !== undefined) {
          root = orphanRoot;
        } else {
          container.textContent = '';
          (container as DswViewContainer).__dswWorkflowRoot = undefined;
        }
      } else {
        const column = document.querySelector<HTMLElement>(CENTER_COLUMN_SELECTOR);
        if (column === null) return;
        container = document.createElement('div');
        container.dataset.dshWorkflowView = '';
        column.appendChild(container);
      }
    }
    if (root === undefined) {
      root = createRoot(container);
      (container as DswViewContainer).__dswWorkflowRoot = root;
    }
    const parent = container.parentElement;
    if (rootObserver === undefined && parent !== null) {
      rootObserver = new MutationObserver(() => {
        if (container === undefined) return;
        const col = container.parentElement;
        if (col === null || !col.isConnected) return;
        if (!col.contains(container)) col.appendChild(container);
      });
      rootObserver.observe(parent, { childList: true });
    }
    renderIfOpen();
  };

  const waitObserver =
    typeof document !== 'undefined' && document.body !== null
      ? new MutationObserver(() => {
          if (document.querySelector(CENTER_COLUMN_SELECTOR) !== null) {
            try {
              ensureContainer();
            } catch (error) {
              console.error('[dsh-workflow] studio ensure failed:', error);
            }
          }
        })
      : undefined;
  waitObserver?.observe(document.body, { childList: true, subtree: true });

  // 关键：注册订阅器，每次开关/切换都会触发重新渲染与挂载！
  const unsubscribeOpen = subscribeStudioOpen(() => {
    ensureContainer();
    renderIfOpen();
  });

  try {
    ensureContainer();
  } catch (error) {
    console.error('[dsh-workflow] studio mount failed:', error);
  }

  applyActiveAttr();

  return {
    isOpen: () => isStudioOpenNow(),
    handleGate(gate): void {
      try {
        syncStudioGate(gate);
        renderIfOpen();
      } catch (error) {
        console.error('[dsh-workflow] studio gate sync failed:', error);
      }
    },
    dispose(): void {
      try {
        unsubscribeOpen();
        waitObserver?.disconnect();
        rootObserver?.disconnect();
        rootObserver = undefined;
        try {
          root?.unmount();
        } catch (error) {
          console.error('[dsh-workflow] studio unmount failed:', error);
        }
        root = undefined;
        rendered = false;
        container?.remove();
        if (container !== undefined) delete (container as DswViewContainer).__dswWorkflowRoot;
        container = undefined;
        isStudioOpen = false;
        activeSessionId = undefined;
        applyActiveAttr();
      } catch (error) {
        console.error('[dsh-workflow] studio dispose failed:', error);
      }
    },
  };
}
