/**
 * Studio 画布（M2 接管旧 src/canvas.tsx 职责）。
 * - 节点组件来自 NODE_REGISTRY 各类型 CardComponent（makeFlowCard 适配 xyflow）；
 * - 分支边 true/false 徽章、running 加粗走 StudioBranchEdge；
 * - 原生 Controls/MiniMap 弃用 → ZoomCapsule + StudioMiniMap 自绘玻璃卡；
 * - 布局 layoutNodesMeasured（240 宽 + 实测高度），无钉死像素端口；
 * - @xyflow 默认视觉由 xyflow-theme.css 的 --xy-* 变量覆盖。
 */
import React, { useCallback, useMemo } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  type Node as FlowNode,
  type Edge as FlowEdge,
  type EdgeTypes,
  type NodeTypes,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { normalizeStatus, type WorkflowCanvasProps, type NodeStateInfo, type WorkflowDSL, type WorkflowEdge, type WorkflowNode } from "../types.js";
import { NODE_REGISTRY } from "../nodes/registry.js";
import { makeFlowCard } from "../nodes/shared/card-shell.js";
import { StudioBranchEdge } from "./branch-edge.js";
import { ZoomCapsule } from "./zoom-capsule.js";
import { StudioMiniMap } from "./minimap.js";
import { layoutNodesMeasured, type MeasuredSize } from "./layout-v2.js";
import "./xyflow-theme.css";

/** 注册表 → xyflow nodeTypes 映射（模块级构建一次）。 */
function buildNodeTypes(): NodeTypes {
  const out: NodeTypes = {};
  for (const def of NODE_REGISTRY.values()) {
    out[def.type] = makeFlowCard(def) as NodeTypes[string];
  }
  return out;
}

const NODE_TYPES: NodeTypes = buildNodeTypes();
const EDGE_TYPES: EdgeTypes = { workflowBranch: StudioBranchEdge as EdgeTypes[string] };

export interface StudioCanvasProps extends WorkflowCanvasProps {
  /** 受控选中节点（属性面板联动）；缺省走内部选中。 */
  selectedNodeId?: string | null;
  onSelect?(nodeId: string | null): void;
  /** DSL 实时双向同步（节点拖拽、连线新增/删除） */
  onDslChange?(nextDsl: WorkflowDSL): void;
}

import { useNodesState, useEdgesState, ConnectionMode } from "@xyflow/react";

function CanvasInner({
  dsl,
  nodeStates,
  className,
  style,
  onNodeClick,
  fitView = true,
  selectedNodeId,
  onSelect,
  onDslChange,
}: StudioCanvasProps): React.ReactElement {
  const autoPositions = useMemo(() => layoutNodesMeasured(dsl.nodes, dsl.edges), [dsl.nodes, dsl.edges]);

  const initialFlowNodes = useMemo<FlowNode[]>(() => {
    return dsl.nodes.map((node) => {
      const rawState: NodeStateInfo | { status: string } | undefined = nodeStates?.[node.id];
      const status = normalizeStatus(rawState?.status);
      const customPos = (node as unknown as { position?: { x: number; y: number } }).position;
      const pos = customPos ?? autoPositions.get(node.id) ?? { x: 0, y: 0 };
      return {
        id: node.id,
        type: node.type,
        position: pos,
        data: {
          node,
          status,
          stateInfo: rawState as NodeStateInfo | undefined,
          onNodeClick: () => onSelect?.(node.id),
        },
        selected: selectedNodeId !== undefined ? selectedNodeId === node.id : undefined,
        width: 250,
      };
    });
  }, [dsl.nodes, nodeStates, autoPositions, onSelect, selectedNodeId]);

  const initialFlowEdges = useMemo<FlowEdge[]>(() => {
    return dsl.edges.map((edge) => {
      const sourceStatus = normalizeStatus(nodeStates?.[edge.source]?.status);
      const active = sourceStatus === "running";
      const branchySource = edge.sourceHandle ?? (edge.branch === "true" || edge.branch === "false" ? edge.branch : undefined);
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: branchySource,
        targetHandle: edge.targetHandle,
        type: "workflowBranch",
        animated: active,
        data: { branch: edge.branch, active },
      };
    });
  }, [dsl.edges, nodeStates]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialFlowNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialFlowEdges);

  // 当外部 dsl / 选中项变化时同步到本地状态
  React.useEffect(() => {
    setNodes(initialFlowNodes);
  }, [initialFlowNodes, setNodes]);

  React.useEffect(() => {
    setEdges(initialFlowEdges);
  }, [initialFlowEdges, setEdges]);

  const handleSelect = useCallback(
    (_event: unknown, node: FlowNode) => {
      onSelect?.(node.id);
    },
    [onSelect],
  );

  // 节点拖拽松手后一次性更新 DSL 坐标，拖拽过程中 0 级卡顿
  const handleNodeDragStop = useCallback(
    (_event: unknown, node: FlowNode) => {
      if (!onDslChange) return;
      const nextNodes = dsl.nodes.map((n) =>
        n.id === node.id
          ? ({ ...n, position: { x: Math.round(node.position.x), y: Math.round(node.position.y) } } as unknown as WorkflowNode)
          : n,
      );
      onDslChange({ ...dsl, nodes: nextNodes });
    },
    [dsl, onDslChange],
  );

  // n8n 风格连线：拖拽建立连线
  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target || !onDslChange) return;
      if (connection.source === connection.target) return;
      const exists = dsl.edges.some(
        (e) => e.source === connection.source && e.target === connection.target && e.sourceHandle === (connection.sourceHandle ?? undefined)
      );
      if (exists) return;
      const edgeId = `e_${connection.source}_${connection.target}_${Date.now().toString(36).slice(4)}`;
      const newEdge: WorkflowEdge = {
        id: edgeId,
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle ?? undefined,
        targetHandle: connection.targetHandle ?? undefined,
      };
      onDslChange({ ...dsl, edges: [...dsl.edges, newEdge] });
    },
    [dsl, onDslChange],
  );

  // 边删除
  const handleEdgesDelete = useCallback(
    (deleted: FlowEdge[]) => {
      if (!onDslChange || deleted.length === 0) return;
      const delIds = new Set(deleted.map((d) => d.id));
      onDslChange({ ...dsl, edges: dsl.edges.filter((e) => !delIds.has(e.id)) });
    },
    [dsl, onDslChange],
  );

  return (
    <div
      className={"dsw-flow dsh-workflow-canvas-container " + (className ?? "")}
      style={{ width: "100%", height: "100%", position: "relative", ...style }}
    >
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          nodesDraggable
          nodesConnectable
          elementsSelectable
          connectionMode={ConnectionMode.Loose}
          connectionLineStyle={{ stroke: "#ff6d5a", strokeWidth: 2.2 }}
          snapToGrid
          snapGrid={[16, 16]}
          fitView={fitView}
          proOptions={{ hideAttribution: false }}
          defaultEdgeOptions={{ type: "workflowBranch" }}
          onSelectionChange={({ nodes: selectedNodes }) => {
            if (selectedNodes.length > 0) onSelect?.(selectedNodes[0].id);
            else onSelect?.(null);
          }}
          onNodeClick={handleSelect}
          onNodeDragStop={handleNodeDragStop}
          onConnect={handleConnect}
          onEdgesDelete={handleEdgesDelete}
        >
          <ZoomCapsule />
          <StudioMiniMap />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}

/** 对外画布组件（带 Provider；点阵背景由容器 CSS 提供，不用 xyflow Background）。 */
export function StudioCanvas(props: StudioCanvasProps): React.ReactElement {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

export type { MeasuredSize };
