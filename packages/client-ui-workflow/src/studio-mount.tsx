/**
 * Studio view mounting (M1 rewrite, §2.1 / §10 P0-4 / P1-5 / P1-6 / P1-10 / P2-19).
 *
 * 结构（§10.4 修正后的绑定裁决）：
 * - 容器 div[data-dsh-workflow-view] 挂在 centerCol（'[data-pane="conversation"],
 *   [class*="centerCol"]'）内部尾部；不向宿主 React 协调树注入兄弟节点；
 * - 对话隐藏靠 html[data-dsh-workflow-active] 属性级 CSS（tokens.css，
 *   含 :not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]) 排他守卫）；
 * - MutationObserver 双层自愈：body 级等待 centerCol 出现 + 根级复位重插
 *   （对齐 task-board board-mount 同款机制；整列被宿主重建时退回 body 级等待）；
 * - 三栏：画布区 | 6px 分隔条 | 右侧属性面板（380–600 可拖拽记忆）。
 *
 * 分隔条取舍（§10.4 二选一）：作为容器内部子元素放在画布与右面板之间
 * （面板左缘、视觉上贴画布右侧）。三栏完全位于本插件自有容器内，
 * 不触碰宿主 DOM 结构，宿主 React 协调不受影响。
 *
 * 失败策略：DOM 挂载失败仅 console.error，绝不 throw。
 */
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { StudioCanvas } from './canvas-parts/studio-canvas.js';
import { NODE_REGISTRY } from './nodes/registry.js';
import {
  loadLibrary,
  saveWorkflow,
  setActiveWorkflow,
  type StoredWorkflow,
} from './library.js';
import type { WorkflowDSL, NodeStateInfo, WorkflowNode } from './types.js';
import {
  clampPanelWidth,
  loadLayoutMemory,
  resolveInitialLayout,
  saveLayoutMemory,
} from './studio-layout.js';
import './styles/tokens.css';

export const WORKFLOW_VIEW_SELECTOR = '[data-dsh-workflow-view]';

/** 容器上的 React 根标记：幂等接管时防第二 createRoot 叠加（双树互踩）。 */
interface DswViewContainer extends HTMLDivElement {
  __dswWorkflowRoot?: Root;
}
const CENTER_COLUMN_SELECTOR = '[data-pane="conversation"], [class*="centerCol"]';
const ACTIVE_ATTR = 'data-dsh-workflow-active';

/* ---------------- 激活态 / dismissed（内存级，P2-19） ---------------- */

let isStudioOpen = false;
/** 会话级 dismissed 标记：✕ 关闭后同会话不再自动弹出；切换会话重置。 */
let dismissedSessionId: string | undefined;
let activeSessionId: string | undefined;

const openListeners = new Set<() => void>();

/** 订阅打开状态变化（侧边栏高亮同步用）。返回退订函数。 */
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

/**
 * 门控联动入口（由 client.ts 在 preset-gate 订阅中调用）：
 * - 活动会话变化时重置 dismissed（P2-19 切换会话重置）；
 * - 离开 workflow 会话立即收起（§2.2 行为规格 3）；
 * - 进入 workflow 会话且未被本会话 dismissed 时自动弹出。
 */
export function syncStudioGate(gate: { shouldShow: boolean; activeSessionId: string | undefined }): void {
  if (gate.activeSessionId !== activeSessionId) {
    activeSessionId = gate.activeSessionId;
    dismissedSessionId = undefined;
  }
  if (gate.shouldShow && !isStudioOpen && dismissedSessionId !== gate.activeSessionId) {
    isStudioOpen = true;
  }
  applyActiveAttr();
}

export function openStudio(): void {
  isStudioOpen = true;
  applyActiveAttr();
}

export function closeWorkflowStudio(): void {
  if (activeSessionId !== undefined) dismissedSessionId = activeSessionId;
  isStudioOpen = false;
  applyActiveAttr();
}

export function toggleWorkflowStudio(): void {
  if (isStudioOpen) closeWorkflowStudio();
  else openStudio();
}

/** 测试辅助：当前是否处于打开状态。 */
export function isStudioOpenNow(): boolean {
  return isStudioOpen;
}

/* ---------------- 视图组件（M1 过渡壳） ---------------- */

interface StudioViewProps {
  /** §10.5 公式 / v2 记忆解析出的画布基准宽（仅作 flex-basis 记忆值）。 */
  initialCenterBasis: number;
  initialPanelWidth: number;
}

const StudioView: React.FC<StudioViewProps> = ({ initialCenterBasis, initialPanelWidth }) => {
  const [panelWidth, setPanelWidth] = React.useState(initialPanelWidth);
  const [dragging, setDragging] = React.useState(false);
  const panelWidthRef = React.useRef(panelWidth);
  panelWidthRef.current = panelWidth;

  // 打开即持久化一次初始解析结果（§10.10 刷新恢复布局）。
  React.useEffect(() => {
    saveLayoutMemory({ centerBasis: initialCenterBasis, panelWidth: panelWidthRef.current });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(true);
    document.body.classList.add('dsw-col-resizing');
    const startX = event.clientX;
    const startWidth = panelWidthRef.current;

    const onMove = (moveEvent: PointerEvent): void => {
      // 面板贴容器右缘：向左拖（clientX 减小）→ 面板变宽。
      setPanelWidth(clampPanelWidth(startWidth + (startX - moveEvent.clientX), window.innerWidth));
    };
    const finish = (upEvent: PointerEvent): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      const finalWidth = clampPanelWidth(startWidth + (startX - upEvent.clientX), window.innerWidth);
      setPanelWidth(finalWidth);
      saveLayoutMemory({ panelWidth: finalWidth });
      setDragging(false);
      document.body.classList.remove('dsw-col-resizing');
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }, []);

  // —— M2/M4 接线（Director 集成期）：真实库 + 真实画布 + 注册表面板路由 ——
  const [library, setLibrary] = React.useState(() => loadLibrary());
  const [activeId, setActiveId] = React.useState(library.snapshot.activeId);
  const activeWf: StoredWorkflow | undefined = React.useMemo(
    () => library.snapshot.workflows.find((w) => w.id === activeId) ?? library.snapshot.workflows[0],
    [library, activeId],
  );
  const dsl: WorkflowDSL = activeWf?.dsl ?? { version: 'dsh.workflow.v1', name: '空白工作流', nodes: [], edges: [] };

  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null);
  const [nodeStates] = React.useState<Record<string, NodeStateInfo>>({});

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

  const handleRenameActive = (name: string): void => {
    if (!activeWf || name.trim() === '' || name === activeWf.name) return;
    saveWorkflow({ id: activeWf.id, name, dsl: activeWf.dsl });
    setLibrary(loadLibrary());
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      {/* 工具栏：标题+模式徽章 → 工作流切换 → ✕ 关闭 */}
      <div className="dsw-view-toolbar">
        <div className="dsw-toolbar-left">
          <div className="dsw-app-title">⚡ 工作流工作台</div>
          <span className="dsw-mode-badge">Dify/Coze 模式</span>
          <select
            className="dsw-workflow-select"
            value={activeWf?.id ?? ''}
            onChange={(e) => {
              const wf = library.snapshot.workflows.find((w) => w.id === e.target.value);
              if (wf) handleSelectWorkflow(wf);
            }}
            aria-label="选择工作流"
          >
            {library.snapshot.workflows.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>
        <div className="dsw-toolbar-right">
          <button type="button" className="dsw-btn-icon" onClick={closeWorkflowStudio} title="关闭工作台" aria-label="关闭工作台">✕</button>
        </div>
      </div>

      {/* 主区：画布 | 分隔条 | 属性面板 */}
      <div className="dsw-view-main">
        <div
          className="dsw-view-canvas"
          data-testid="workflow-studio-canvas"
          style={{ flex: '0 1 auto', flexBasis: initialCenterBasis, minWidth: 0 }}
        >
          <StudioCanvas
            dsl={dsl}
            nodeStates={nodeStates}
            selectedNodeId={selectedNodeId}
            onSelect={setSelectedNodeId}
          />
        </div>
        <div
          className={dragging ? 'dsw-splitter is-dragging' : 'dsw-splitter'}
          role="separator"
          aria-orientation="vertical"
          title="拖拽调整面板宽度"
          onPointerDown={onPointerDown}
        >
          <div className="dsw-splitter-handle" />
        </div>
        <aside className="dsw-prop-panel" data-testid="workflow-studio-panel" style={{ width: panelWidth }}>
          <div className="dsw-prop-header">
            <span className="dsw-prop-title">🔧 节点属性配置</span>
            {selectedNode && <span className="dsw-mode-badge">{String(selectedNode.type)}</span>}
            <button type="button" className="dsw-btn-icon" onClick={closeWorkflowStudio} title="关闭工作台" aria-label="关闭工作台">✕</button>
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
                  saveWorkflow({ id: activeWf.id, dsl: nextDsl });
                  setLibrary(loadLibrary());
                }}
              />
            ) : (
              <p className="dsw-prop-placeholder">
                未选中节点。点击画布节点以配置其属性。
              </p>
            )}
          </div>
        </aside>
      </div>

      {/* 底部日志栏占位：执行态色统一品牌蓝（§10 P2-17），M3 运行接线随联调接入 */}
      <div className="dsw-view-footer">
        <span>状态日志: 就绪</span>
        <span className="dsw-footer-status">● 引擎就绪</span>
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
  /** 当前是否处于打开状态（侧边栏高亮同步）。 */
  isOpen: () => boolean;
  /** 门控联动：preset-gate 每次快照变化时调用。 */
  handleGate: (gate: StudioGateInput) => void;
  /** 卸载：由 ctx.effect 注册释放（§10 P1-9 成对约定）。 */
  dispose: () => void;
}

/**
 * 挂载工作台容器（幂等：容器已存在则接管）。DOM 失败仅 console.error。
 */
export function mountStudio(): MountController {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  let rendered = false;
  let rootObserver: MutationObserver | undefined;

  const renderIfOpen = (): void => {
    if (container === undefined || root === undefined) return;
    if (isStudioOpen && !rendered) {
      // 每次打开重新解析初始布局（§10.5 公式 + §10.10 v2 记忆按当前视口重 clamp）。
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
      // 收起：卸载 React 子树但保留容器占位（CSS 已隐藏容器）。
      root.render(null);
      rendered = false;
    }
  };

  const ensureContainer = (): void => {
    if (typeof document === 'undefined') return;
    // 旧容器若已脱离文档（宿主整列重建），先丢弃其 React 根再重建。
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
      // 幂等接管：页面里已有本插件容器（重复 apply / HMR 重注）时直接复用。
      const existing = document.querySelector<HTMLElement>(WORKFLOW_VIEW_SELECTOR);
      if (existing !== null) {
        container = existing as HTMLDivElement;
        // 防双 React 根互踩：容器上已挂着存活根标记 → 只复用根、绝不二次 createRoot
        // （dispose 缺失场景下两棵树会叠加渲染同一容器）。无标记则强制清空遗留子节点
        // （旧树已死但 DOM 残留），再挂上本模块的根标记。
        const orphanRoot = (container as DswViewContainer).__dswWorkflowRoot;
        if (orphanRoot !== undefined) {
          root = orphanRoot;
        } else {
          container.textContent = '';
          (container as DswViewContainer).__dswWorkflowRoot = undefined;
        }
      } else {
        const column = document.querySelector<HTMLElement>(CENTER_COLUMN_SELECTOR);
        if (column === null) return; // centerCol 未渲染：交由 body 级观察器等待。
        container = document.createElement('div');
        container.dataset.dshWorkflowView = '';
        // 尾部追加（§10.4）：不插入宿主兄弟节点，不扰动既有子元素顺序。
        column.appendChild(container);
      }
    }
    if (root === undefined) {
      root = createRoot(container);
      (container as DswViewContainer).__dswWorkflowRoot = root;
    }
    // 根级复位重插：宿主 React 重渲染挤掉容器时同帧补回（微任务先于绘制，无闪烁）。
    const parent = container.parentElement;
    if (rootObserver === undefined && parent !== null) {
      rootObserver = new MutationObserver(() => {
        if (container === undefined) return;
        const col = container.parentElement;
        if (col === null || !col.isConnected) return; // 整列重建 → 交给 body 级观察器。
        if (!col.contains(container)) col.appendChild(container);
      });
      rootObserver.observe(parent, { childList: true });
    }
    renderIfOpen();
  };

  // 第一层：body 级等待 —— centerCol 尚未渲染时持续观察其出现；
  // 整列被宿主重建后也由它发现新列（此时根级观察器已随旧树失效）。
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
        dismissedSessionId = undefined;
        applyActiveAttr();
      } catch (error) {
        console.error('[dsh-workflow] studio dispose failed:', error);
      }
    },
  };
}