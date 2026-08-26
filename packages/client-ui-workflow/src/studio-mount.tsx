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
  const hasAttr = document.documentElement.hasAttribute(ACTIVE_ATTR);
  const shouldHave = isStudioOpen;
  // 属性无变化时不通知：syncUi → handleGate → applyActiveAttr → emitOpenChange
  // 双向链路依赖此守卫终止，否则门控更新与开关状态互推会无限递归。
  if (hasAttr === shouldHave) return;
  if (shouldHave) document.documentElement.setAttribute(ACTIVE_ATTR, '');
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
  const [isEngineOnline, setIsEngineOnline] = React.useState(false);
  const [isLaunching, setIsLaunching] = React.useState(false);

  // 组件挂载守卫：卸载后不再执行异步操作
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // 静默注入鉴权包（确保浏览器会话即刻持有 n8n-auth cookie，零登录弹窗）
  const silentEnsureAuth = React.useCallback(async () => {
    try {
      await fetch('/n8n/rest/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          emailOrLdapLoginId: 'admin@123.abc',
          password: 'admin123',
        }),
      });
    } catch { /* noop */ }
  }, []);

  // 检查 n8n 引擎健康状态（通过当前站点的同源 /n8n/ 相对反代路径探测，彻底消除 CORS 与 127.0.0.1 跨域）
  const checkEngine = React.useCallback(async () => {
    if (!mountedRef.current) return false;
    try {
      const res = await fetch('/n8n/rest/settings', { method: 'GET', credentials: 'include' }).catch(() => null);
      if (res && res.status === 200) {
        if (mountedRef.current) setIsEngineOnline(true);
        void silentEnsureAuth();
        return true;
      }
    } catch { /* noop */ }
    if (mountedRef.current) setIsEngineOnline(false);
    return false;
  }, [silentEnsureAuth]);

  React.useEffect(() => {
    void checkEngine();
    const timer = setInterval(() => { void checkEngine(); }, 4000);
    return () => clearInterval(timer);
  }, [checkEngine]);

  const handleLaunchEngine = React.useCallback(async () => {
    if (!mountedRef.current) return;
    setIsLaunching(true);
    try {
      // 触发后端尝试自愈拉起
      await fetch('/api/plugins/dsh-workflow/start-engine', { method: 'POST' }).catch(() => null);
      // 持续轮询直至上线
      for (let i = 0; i < 15; i++) {
        if (!mountedRef.current) break;
        await new Promise((r) => setTimeout(r, 1000));
        if (!mountedRef.current) break;
        const ok = await checkEngine();
        if (ok) {
          if (mountedRef.current) {
            setIframeKey((k) => k + 1);
            setIsLoading(true);
          }
          break;
        }
      }
    } finally {
      if (mountedRef.current) setIsLaunching(false);
    }
  }, [checkEngine]);

  React.useEffect(() => {
    document.documentElement.style.setProperty('--dsw-workflow-width', `${workflowWidth}px`);
  }, [workflowWidth]);

  // 中栏会话与工作台之间的左侧主分隔条拖拽
  const dragHandlersRef = React.useRef<{ onMove: (e: PointerEvent) => void; finish: () => void } | null>(null);
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
    };

    const finish = (): void => {
      // 拖拽结束时才写入 localStorage（避免每帧 pointermove 写存储）
      saveLayoutMemory({ centerBasis: workflowWidthRef.current, panelWidth: initialPanelWidth });
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      document.body.classList.remove('dsw-col-resizing');
    };

    dragHandlersRef.current = { onMove, finish };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }, [initialPanelWidth]);

  // 卸载时清理拖拽状态：移除 body 类并摘除 window 级监听器（防止拖拽中 unmount 后残留）
  React.useEffect(() => {
    return () => {
      document.body.classList.remove('dsw-col-resizing');
      if (dragHandlersRef.current !== null) {
        const { onMove, finish } = dragHandlersRef.current;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', finish);
        dragHandlersRef.current = null;
      }
    };
  }, []);

  // 默认直接使用同源反代路径，消除所有跨源、端口限制与 Mixed Content 阻断
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
        <div className="dsw-view-toolbar" style={{ background: 'var(--dsw-glass-bg)', height: 48, padding: '0 12px' }}>
          <div className="dsw-toolbar-left" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="dsw-app-title" style={{ fontSize: 13, fontWeight: 700 }}>⚡ 工作流 Studio</div>
            <span
              className="dsw-mode-badge"
              style={{
                background: isEngineOnline ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                color: isEngineOnline ? '#10b981' : '#ef4444',
                borderColor: isEngineOnline ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)',
                fontWeight: 600,
              }}
            >
              {isEngineOnline ? '● 引擎运行中' : '○ 引擎离线'}
            </span>
          </div>

          <div className="dsw-toolbar-right" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {!isEngineOnline && (
              <button
                type="button"
                className="dsw-btn-icon"
                onClick={handleLaunchEngine}
                disabled={isLaunching}
                title="启动本地 n8n 引擎服务"
                style={{
                  width: 'auto',
                  padding: '0 10px',
                  height: 28,
                  fontSize: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  background: '#10b981',
                  color: '#ffffff',
                  borderColor: '#059669',
                  cursor: isLaunching ? 'not-allowed' : 'pointer',
                }}
              >
                {isLaunching ? '⏳ 启动中...' : '▶ 启动引擎'}
              </button>
            )}
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
              style={{ width: 'auto', padding: '0 10px', height: 28, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, background: 'var(--dsw-tint-bg)', color: 'var(--dsw-tint-text)', borderColor: 'var(--dsw-tint-border)' }}
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
          {/* P0-1 安全加固：同源 iframe（/n8n/ 相对反代）显式声明最小 sandbox 授权集，
           禁掉 plugins/presentation 等能力；referrerPolicy=no-referrer 不在请求头携带来源。
           注意：allow-scripts + allow-same-origin 组合在同源场景下 iframe 可自改自身
           sandbox 属性，等于无 sandbox——根治路径是把 n8n 反代挂到独立 origin
           （不同端口/子域/独立静态托管），届时 sandbox 才能真正约束脚本。 */}
          <iframe
            key={iframeKey}
            src={n8nUrl}
            title="n8n Official Workflow Editor"
            sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups"
            referrerPolicy="no-referrer"
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
  let siblingPanelObserver: MutationObserver | undefined;

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
    // 在创建 container 后立即捕获父元素引用，避免后续 parentElement 变为 null
    const parent = container.parentElement;
    if (rootObserver === undefined && parent !== null) {
      rootObserver = new MutationObserver(() => {
        if (container === undefined) return;
        // 使用已捕获的 parent 引用，而非反复读取 container.parentElement
        if (parent === null || !parent.isConnected) return;
        if (!parent.contains(container)) parent.appendChild(container);
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

  // 社区插件（任务看板、SSH 面板）互斥监听：移入 mount 生命周期，dispose 时得以断开
  if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
    siblingPanelObserver = new MutationObserver((mutations) => {
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
        siblingPanelObserver?.disconnect();
        siblingPanelObserver = undefined;
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