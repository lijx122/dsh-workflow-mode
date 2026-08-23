/**
 * Studio 画布（M2 接管旧 src/canvas.tsx 职责）。
 * - 节点组件来自 NODE_REGISTRY 各类型 CardComponent（makeFlowCard 适配 xyflow）；
 * - 分支边 true/false 徽章、running 加粗走 StudioBranchEdge；
 * - 原生 Controls/MiniMap 弃用 → ZoomCapsule + StudioMiniMap 自绘玻璃卡；
 * - 布局 layoutNodesMeasured（240 宽 + 实测高度），无钉死像素端口；
 * - @xyflow 默认视觉由 xyflow-theme.css 的 --xy-* 变量覆盖。
 */
import React, { useCallback, useMemo } from "react";
import { ReactFlow, ReactFlowProvider, type Node as FlowNode, type Edge as FlowEdge, type EdgeTypes, type NodeTypes } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { normalizeStatus, type WorkflowCanvasProps, type NodeStateInfo } from "../types.js";
import { NODE_REGISTRY } from "../nodes/registry.js";
import { makeFlowCard } from "../nodes/shared/card-shell.js";
import { StudioBranchEdge } from "./branch-edge.js";
import { ZoomCapsule } from "./zoom-capsule.js";
import { StudioMiniMap } from "./minimap.js";
import { layoutNodesMeasured, type MeasuredSize } from "./layout-v2.js";
import "./xyflow-theme.css";

/** 注册表 → xyflow nodeTypes 映射（模块级构建一次）。 */
function buildNodeTypes(): NodeTypes {
  const map: Record<string, FlowNode["type"]> = {};
  const out: NodeTypes = {};
  for (const def of NODE_REGISTRY.values()) {
    void map;
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
}

function CanvasInner({
  dsl,
  nodeStates,
  className,
  style,
  onNodeClick,
  fitView = true,
  selectedNodeId,
  onSelect,
}: StudioCanvasProps): React.ReactElement {
  const positions = useMemo(() => layoutNodesMeasured(dsl.nodes, dsl.edges), [dsl.nodes, dsl.edges]);

  const flowNodes = useMemo<FlowNode[]>(() => {
    return dsl.nodes.map((node) => {
      const rawState: NodeStateInfo | { status: string } | undefined = nodeStates?.[node.id];
      const status = normalizeStatus(rawState?.status);
      const def = NODE_REGISTRY.get(node.type);
      const pos = positions.get(node.id) ?? { x: 0, y: 0 };
      return {
        id: node.id,
        type: node.type,
        position: pos,
        data: {
          node,
          status,
          stateInfo: rawState as NodeStateInfo | undefined,
          onNodeClick,
        },
        selected: selectedNodeId !== undefined ? selectedNodeId === node.id : undefined,
        // 卡宽固定 240；高度交给实测（layout v2 只用估算值做首帧间距）。
        width: 240,
        ...(def === undefined ? {} : {}),
      };
    });
  }, [dsl.nodes, nodeStates, positions, onNodeClick, selectedNodeId]);

  const flowEdges = useMemo<FlowEdge[]>(() => {
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

  const handleSelect = useCallback(
    (_event: unknown, node: FlowNode) => {
      onSelect?.(node.id);
    },
    [onSelect],
  );

  return (
    <div
      className={"dsw-flow dsh-workflow-canvas-container " + (className ?? "")}
      style={{ width: "100%", height: "100%", position: "relative", ...style }}
    >
      <ReactFlowProvider>
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          nodesDraggable
          nodesConnectable={false}
          elementsSelectable
          fitView={fitView}
          proOptions={{ hideAttribution: false }}
          defaultEdgeOptions={{ type: "workflowBranch" }}
          onSelectionChange={({ nodes }) => {
            if (nodes.length > 0) onSelect?.(nodes[0].id);
            else onSelect?.(null);
          }}
          onNodeClick={handleSelect}
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
