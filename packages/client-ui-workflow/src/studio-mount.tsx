/**
 * DSH Web GUI Client Plugin - Direct Native n8n Workflow Studio Integration.
 *
 * 核心架构：
 * - 直接内嵌 100% 官方正版原生 n8n 工作流工作台（全量官方节点、极速 VueFlow 画布、原生数据调试器）；
 * - 左（DSH 会话列表）+ 中（DSH 聊天交互，保留对话互动）+ 右（原生 n8n 工作台）；
 * - 左边缘配备可拖拽调宽分隔条，支持任意滑动调整中右面板宽度；
 * - 顶部工具栏支持全屏/新标签页一键打开、重新载入与关闭。
 */
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
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

/* ---------------- 视图组件（原生 n8n 直接内嵌） ---------------- */

interface StudioViewProps {
  initialCenterBasis: number;
  initialPanelWidth: number;
}

const StudioView: React.FC<StudioViewProps> = ({ initialCenterBasis, initialPanelWidth }) => {
  const [workflowWidth, setWorkflowWidth] = React.useState(() => {
    try {
      const stored = loadLayoutMemory();
      if (stored?.centerBasis && stored.centerBasis >= 420) return stored.centerBasis;
    } catch { /* noop */ }
    return Math.max(500, Math.min(1000, Math.round(window.innerWidth * 0.62)));
  });
  const workflowWidthRef = React.useRef(workflowWidth);
  workflowWidthRef.current = workflowWidth;

  const [iframeKey, setIframeKey] = React.useState(1);
  const [isLoading, setIsLoading] = React.useState(true);

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
      saveLayoutMemory({ centerBasis: nextW, panelWidth: initialPanelWidth });
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
  }, [initialPanelWidth]);

  const n8nUrl = typeof window !== 'undefined' ? `${window.location.origin}/n8n/` : '/n8n/';

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
        <div className="dsw-view-toolbar" style={{ background: 'var(--glass-bg)', height: 48, padding: '0 12px' }}>
          <div className="dsw-toolbar-left" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="dsw-app-title" style={{ fontSize: 13, fontWeight: 700 }}>⚡ 工作流 Studio</div>
            <span className="dsw-mode-badge" style={{ background: 'rgba(255, 109, 90, 0.12)', color: '#ff6d5a', borderColor: 'rgba(255, 109, 90, 0.3)', fontWeight: 600 }}>
              n8n 官方原生
            </span>
          </div>

          <div className="dsw-toolbar-right" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="dsw-btn-icon"
              onClick={() => {
                setIsLoading(true);
                setIframeKey((k) => k + 1);
              }}
              title="重新载入工作流"
              style={{ width: 'auto', padding: '0 10px', height: 28, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
            >
              🔄 刷新
            </button>
            <button
              type="button"
              className="dsw-btn-icon"
              onClick={() => window.open(n8nUrl, '_blank')}
              title="在新标签页中独立全屏打开 n8n"
              style={{ width: 'auto', padding: '0 10px', height: 28, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, background: 'var(--tint-bg)', color: 'var(--tint-text)', borderColor: 'var(--tint-border)' }}
            >
              ↗ 全屏独立窗口
            </button>
            <button type="button" className="dsw-btn-icon" onClick={closeWorkflowStudio} title="关闭工作流面板（恢复会话全宽）" aria-label="关闭工作台">✕</button>
          </div>
        </div>

        {/* 3. n8n 官方原生工作流画布 iframe 容器 */}
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative', background: 'var(--dsw-alias-bg-base)' }}>
          {isLoading && (
            <div style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              background: 'var(--dsw-alias-bg-base)',
              zIndex: 10,
            }}>
              <div style={{ fontSize: 13, color: 'var(--dsw-alias-label-secondary)' }}>正在连接 n8n 官方工作流引擎...</div>
            </div>
          )}
          <iframe
            key={iframeKey}
            src={n8nUrl}
            title="n8n Official Workflow Editor"
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
              display: 'block',
            }}
            onLoad={() => setIsLoading(false)}
            allow="clipboard-read; clipboard-write;"
          />
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
