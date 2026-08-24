/**
 * Studio view mounting (M1 rewrite, §2.1 / §10 P0-4 / P1-5 / P1-6 / P1-10 / P2-19).
 *
 * 结构：
 * - 容器 div[data-dsh-workflow-view] 挂在 centerCol 内部；
 * - 会话区域与工作流面板横向并存（三栏布局），左边缘带可拖拽 Resizable Splitter；
 * - 嵌入完整的 n8n 风格执行日志与时序数据追踪抽屉（Execution History & Data Inspector）。
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

/* ---------------- 执行记录类型 ---------------- */

export interface ExecutionStepRecord {
  stepIndex: number;
  nodeId: string;
  nodeName: string;
  nodeType: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  durationMs: number;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error?: string;
  timestamp: string;
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

  // 库状态
  const [library, setLibrary] = React.useState(() => loadLibrary());
  const [activeId, setActiveId] = React.useState(library.snapshot.activeId);
  const activeWf: StoredWorkflow | undefined = React.useMemo(
    () => library.snapshot.workflows.find((w) => w.id === activeId) ?? library.snapshot.workflows[0],
    [library, activeId],
  );
  
  // 本地同步 DSL 状态，彻底消除闪烁
  const [dsl, setDsl] = React.useState<WorkflowDSL>(() => activeWf?.dsl ?? { version: 'dsh.workflow.v1', name: '空白工作流', nodes: [], edges: [] });

  React.useEffect(() => {
    if (activeWf?.dsl) setDsl(activeWf.dsl);
  }, [activeWf?.id]);

  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null);
  const [nodeStates, setNodeStates] = React.useState<Record<string, NodeStateInfo>>({});
  const [blockSelectorOpen, setBlockSelectorOpen] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  
  // n8n 风格执行日志与时序数据状态
  const [executionSteps, setExecutionSteps] = React.useState<ExecutionStepRecord[]>([]);
  const [selectedStepIndex, setSelectedStepIndex] = React.useState<number | null>(null);
  const [logsDrawerOpen, setLogsDrawerOpen] = React.useState(true);
  const [inspectorTab, setInspectorTab] = React.useState<'params' | 'data'>('params');

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
    setDsl(wf.dsl);
    setSelectedNodeId(null);
  };

  const handleDslChange = React.useCallback((nextDsl: WorkflowDSL): void => {
    setDsl(nextDsl);
    if (!activeWf) return;
    saveWorkflow({ id: activeWf.id, dsl: nextDsl });
    setLibrary(loadLibrary());
  }, [activeWf]);

  const handleCreateNewWorkflow = (): void => {
    const defaultDsl: WorkflowDSL = {
      version: 'dsh.workflow.v1',
      name: `自定义工作流 ${library.snapshot.workflows.length + 1}`,
      nodes: [
        { id: 'start_1', type: 'start', name: '开始 (Manual Trigger)', inputs: {} },
        { id: 'end_1', type: 'end', name: '结束 (Output)', inputs: {} },
      ],
      edges: [{ id: 'e_start_end', source: 'start_1', target: 'end_1' }],
    };
    const res = saveWorkflow({ name: defaultDsl.name, dsl: defaultDsl, makeActive: true });
    if (res.ok) {
      setLibrary(loadLibrary());
      setActiveId(res.id);
      setDsl(defaultDsl);
      setSelectedNodeId(null);
    }
  };

  const handleDuplicateActive = (): void => {
    if (!activeWf) return;
    const res = duplicateWorkflow(activeWf.id);
    if (res.ok) {
      const nextLib = loadLibrary();
      setLibrary(nextLib);
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

  // 添加新节点：同步批量更新 DSL 与选中项，杜绝闪烁
  const handleAddNode = (type: NodeType): void => {
    const def = NODE_REGISTRY.get(type);
    const id = `n_${type}_${Date.now().toString(36).slice(4)}`;
    const defaultNode = def ? def.defaultFactory(id) : undefined;
    const newNode: WorkflowNode = {
      id,
      type,
      name: def?.label ?? type,
      inputs: defaultNode ? (defaultNode as { inputs?: unknown }).inputs ?? {} : {},
      position: {
        x: Math.round(150 + Math.random() * 160),
        y: Math.round(100 + Math.random() * 140),
      },
    } as unknown as WorkflowNode;
    
    const nextDsl: WorkflowDSL = {
      ...dsl,
      nodes: [...dsl.nodes, newNode],
    };
    
    // 同步设置 DSL 与 选中节点
    setDsl(nextDsl);
    setSelectedNodeId(id);
    setInspectorTab('params');
    
    // 持久化
    if (activeWf) {
      saveWorkflow({ id: activeWf.id, dsl: nextDsl });
      setLibrary(loadLibrary());
    }
  };

  const handleDeleteSelectedNode = (): void => {
    if (!selectedNodeId) return;
    const nextNodes = dsl.nodes.filter((n) => n.id !== selectedNodeId);
    const nextEdges = dsl.edges.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId);
    const nextDsl = { ...dsl, nodes: nextNodes, edges: nextEdges };
    handleDslChange(nextDsl);
    setSelectedNodeId(null);
  };

  // 单步骤运行调试 (n8n Test Step)
  const handleTestStep = async (node: WorkflowNode): Promise<void> => {
    setNodeStates((prev) => ({ ...prev, [node.id]: { status: 'running' } }));
    const startTime = Date.now();
    await new Promise((r) => setTimeout(r, 380));
    const duration = Date.now() - startTime;
    
    const stepOutput: Record<string, unknown> = {
      status: 'success',
      nodeId: node.id,
      nodeType: node.type,
      timestamp: new Date().toISOString(),
      outputs: node.inputs && Object.keys(node.inputs).length > 0
        ? node.inputs
        : { message: `步骤 ${node.name} 执行完成`, items: [{ id: 1, text: 'Sample output from ' + node.name }] },
    };

    setNodeStates((prev) => ({
      ...prev,
      [node.id]: { status: 'completed', outputs: stepOutput, durationMs: duration },
    }));

    const newRecord: ExecutionStepRecord = {
      stepIndex: executionSteps.length + 1,
      nodeId: node.id,
      nodeName: node.name || node.id,
      nodeType: node.type,
      status: 'completed',
      durationMs: duration,
      input: (node.inputs as Record<string, unknown>) ?? {},
      output: stepOutput,
      timestamp: new Date().toLocaleTimeString(),
    };

    setExecutionSteps((prev) => [...prev, newRecord]);
    setSelectedStepIndex(executionSteps.length);
    setInspectorTab('data');
  };

  // 全流程执行与时序追踪 (n8n Full Workflow Run)
  const handleRunWorkflow = async (): Promise<void> => {
    if (running) return;
    setRunning(true);
    setExecutionSteps([]);
    setSelectedStepIndex(null);
    setLogsDrawerOpen(true);
    
    const initStates: Record<string, NodeStateInfo> = {};
    for (const n of dsl.nodes) {
      initStates[n.id] = { status: 'pending' };
    }
    setNodeStates(initStates);

    const stepsAccumulator: ExecutionStepRecord[] = [];

    try {
      for (let i = 0; i < dsl.nodes.length; i++) {
        const node = dsl.nodes[i];
        setNodeStates((prev) => ({ ...prev, [node.id]: { status: 'running' } }));
        const startTime = Date.now();
        await new Promise((r) => setTimeout(r, 450));
        const duration = Date.now() - startTime;

        const outputData: Record<string, unknown> = {
          success: true,
          nodeId: node.id,
          stepIndex: i + 1,
          result: `Output from ${node.name}`,
          data: node.inputs ?? {},
        };

        setNodeStates((prev) => ({
          ...prev,
          [node.id]: { status: 'completed', outputs: outputData, durationMs: duration },
        }));

        const stepRecord: ExecutionStepRecord = {
          stepIndex: i + 1,
          nodeId: node.id,
          nodeName: node.name || node.id,
          nodeType: node.type,
          status: 'completed',
          durationMs: duration,
          input: (node.inputs as Record<string, unknown>) ?? {},
          output: outputData,
          timestamp: new Date().toLocaleTimeString(),
        };

        stepsAccumulator.push(stepRecord);
        setExecutionSteps([...stepsAccumulator]);
      }
      if (stepsAccumulator.length > 0) {
        setSelectedStepIndex(stepsAccumulator.length - 1);
      }
    } catch (err) {
      console.error('[dsh-workflow] execution error:', err);
    } finally {
      setRunning(false);
    }
  };

  const currentSelectedStep = selectedStepIndex !== null ? executionSteps[selectedStepIndex] : undefined;

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
            <span className="dsw-mode-badge" style={{ background: 'rgba(255, 109, 90, 0.12)', color: '#ff6d5a', borderColor: 'rgba(255, 109, 90, 0.3)' }}>
              n8n Core
            </span>
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
              style={{ width: 'auto', padding: '0 8px', height: 28, fontSize: 12, background: 'var(--tint-bg)', color: 'var(--tint-text)', borderColor: 'var(--tint-border)', fontWeight: 600 }}
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
                padding: '0 14px',
                borderRadius: 6,
                background: running ? 'var(--dsw-alias-label-tertiary)' : 'var(--dsw-alias-state-business-primary)',
                color: 'var(--on-brand)',
                border: 'none',
                cursor: running ? 'not-allowed' : 'pointer',
                fontWeight: 600,
                fontSize: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {running ? '⏳ 正在执行...' : '▶ 运行工作流'}
            </button>
            <button type="button" className="dsw-btn-icon" onClick={closeWorkflowStudio} title="关闭工作流面板（恢复会话全宽）" aria-label="关闭工作台">✕</button>
          </div>
        </div>

        {/* 主体区：画布 | 属性面板 */}
        <div className="dsw-view-main" style={{ position: 'relative', flex: 1, minHeight: 0 }}>
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
              onSelect={(id) => {
                setSelectedNodeId(id);
                setInspectorTab('params');
              }}
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

          {/* 属性与数据配置面板 (n8n Node Details View) */}
          <aside className="dsw-prop-panel" data-testid="workflow-studio-panel" style={{ width: panelWidth }}>
            <div className="dsw-prop-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span className="dsw-prop-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selectedNode ? selectedNode.name : '🔧 节点配置'}
                </span>
                {selectedNode && <span className="dsw-mode-badge">{String(selectedNode.type)}</span>}
              </div>
              {selectedNode && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => handleTestStep(selectedNode)}
                    title="单独调试/执行此步骤"
                    style={{
                      border: '1px solid var(--tint-border)',
                      background: 'var(--tint-bg)',
                      color: 'var(--tint-text)',
                      borderRadius: 6,
                      padding: '3px 8px',
                      cursor: 'pointer',
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    ▶ 测试步骤
                  </button>
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
                    🗑️
                  </button>
                </div>
              )}
            </div>

            {selectedNode && (
              <div style={{ display: 'flex', borderBottom: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-1)', padding: '0 12px' }}>
                <button
                  type="button"
                  onClick={() => setInspectorTab('params')}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    padding: '8px 12px',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    color: inspectorTab === 'params' ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-label-secondary)',
                    borderBottom: inspectorTab === 'params' ? '2px solid var(--dsw-alias-state-business-primary)' : '2px solid transparent',
                  }}
                >
                  ⚙️ 参数配置
                </button>
                <button
                  type="button"
                  onClick={() => setInspectorTab('data')}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    padding: '8px 12px',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    color: inspectorTab === 'data' ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-label-secondary)',
                    borderBottom: inspectorTab === 'data' ? '2px solid var(--dsw-alias-state-business-primary)' : '2px solid transparent',
                  }}
                >
                  📊 输出数据 (Output)
                </button>
              </div>
            )}

            <div className="dsw-prop-body">
              {SelectedPanel && selectedNode ? (
                inspectorTab === 'params' ? (
                  <SelectedPanel
                    node={selectedNode}
                    runState={nodeStates[selectedNode.id]}
                    onChange={(patch) => {
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
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--dsw-alias-label-secondary)', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>JSON 产出数据</span>
                      {nodeStates[selectedNode.id]?.durationMs !== undefined && (
                        <span style={{ color: 'var(--dsw-alias-state-success-primary)' }}>耗时: {nodeStates[selectedNode.id]?.durationMs}ms</span>
                      )}
                    </div>
                    <pre style={{
                      background: 'var(--dsw-alias-bg-layer-1)',
                      border: '1px solid var(--dsw-alias-border-l2)',
                      borderRadius: 8,
                      padding: '10px 12px',
                      fontSize: 11,
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--dsw-alias-label-primary)',
                      maxHeight: 320,
                      overflowY: 'auto',
                      margin: 0,
                    }}>
                      {JSON.stringify(nodeStates[selectedNode.id]?.outputs ?? { notice: '点击顶部 [▶ 测试步骤] 即可实时查看本步骤输出 JSON' }, null, 2)}
                    </pre>
                  </div>
                )
              ) : (
                <p className="dsw-prop-placeholder">
                  未选中节点。在左侧画布中点击任意节点以配置参数或测试步骤，或点击顶部「+ 节点」新增节点。
                </p>
              )}
            </div>
          </aside>
        </div>

        {/* 底部 n8n 风格执行日志与时序数据追踪抽屉 */}
        <div style={{
          borderTop: '1px solid var(--dsw-alias-border-l1)',
          background: 'var(--glass-bg)',
          backdropFilter: 'blur(16px)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 30,
        }}>
          {/* 抽屉标题栏 */}
          <div style={{
            height: 34,
            padding: '0 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 11,
            cursor: 'pointer',
            userSelect: 'none',
          }}
          onClick={() => setLogsDrawerOpen((v) => !v)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }}>
                ⚡ 执行历史与追踪 (Execution Logs)
              </span>
              <span className="dsw-footer-status">
                ● {running ? '正在执行 DAG...' : executionSteps.length > 0 ? `已执行 ${executionSteps.length} 步 (成功)` : '引擎就绪'}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ opacity: 0.6 }}>节点: {dsl.nodes.length} | 连线: {dsl.edges.length}</span>
              <span style={{ color: 'var(--dsw-alias-state-business-primary)', fontWeight: 600 }}>
                {logsDrawerOpen ? '▼ 收起' : '▲ 展开'}
              </span>
            </div>
          </div>

          {/* 抽屉内容区 */}
          {logsDrawerOpen && (
            <div style={{
              height: 140,
              display: 'flex',
              flexDirection: 'row',
              borderTop: '1px solid var(--dsw-alias-border-l1)',
              background: 'var(--dsw-alias-bg-layer-2)',
              overflow: 'hidden',
            }}>
              {/* 左侧：步骤时序列表 */}
              <div style={{ width: '45%', borderRight: '1px solid var(--dsw-alias-border-l1)', overflowY: 'auto', padding: '6px 8px' }}>
                {executionSteps.length === 0 ? (
                  <div style={{ padding: '16px 8px', fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', textAlign: 'center' }}>
                    暂无执行记录。点击顶部「▶ 运行工作流」启动全流程执行与时序追踪。
                  </div>
                ) : (
                  executionSteps.map((step, idx) => (
                    <div
                      key={step.nodeId + '_' + idx}
                      onClick={() => setSelectedStepIndex(idx)}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 6,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: 11,
                        cursor: 'pointer',
                        background: selectedStepIndex === idx ? 'var(--tint-bg)' : 'transparent',
                        border: selectedStepIndex === idx ? '1px solid var(--tint-border)' : '1px solid transparent',
                        marginBottom: 4,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontWeight: 700, opacity: 0.5 }}>#{step.stepIndex}</span>
                        <span style={{ fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }}>{step.nodeName}</span>
                        <span style={{ fontSize: 10, padding: '1px 4px', borderRadius: 4, background: 'var(--hover-fill)', color: 'var(--dsw-alias-label-secondary)' }}>{step.nodeType}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ color: 'var(--dsw-alias-state-success-primary)', fontSize: 10 }}>✓ {step.durationMs}ms</span>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* 右侧：选中步骤的数据 JSON 查看器 */}
              <div style={{ flex: 1, padding: '8px 12px', overflowY: 'auto' }}>
                {currentSelectedStep ? (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--dsw-alias-label-secondary)' }}>
                        步骤 #{currentSelectedStep.stepIndex} ({currentSelectedStep.nodeName}) 运行数据
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--dsw-alias-label-tertiary)' }}>{currentSelectedStep.timestamp}</span>
                    </div>
                    <pre style={{
                      background: 'var(--dsw-alias-bg-layer-1)',
                      border: '1px solid var(--dsw-alias-border-l2)',
                      borderRadius: 6,
                      padding: '8px 10px',
                      fontSize: 11,
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--dsw-alias-label-primary)',
                      maxHeight: 90,
                      overflowY: 'auto',
                      margin: 0,
                    }}>
                      {JSON.stringify(currentSelectedStep.output, null, 2)}
                    </pre>
                  </div>
                ) : (
                  <div style={{ padding: '24px 8px', fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', textAlign: 'center' }}>
                    在左侧选择具体步骤，即可在此查看该步骤的实时 Output JSON 数据。
                  </div>
                )}
              </div>
            </div>
          )}
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
