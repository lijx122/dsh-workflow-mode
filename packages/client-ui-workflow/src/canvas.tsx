/**
 * @deprecated 自 M2 起废弃（§10.12 迁移清单）：画布已由 src/canvas-parts/studio-canvas.tsx
 *           接管（registry 节点、自绘缩放胶囊/MiniMap、--xy-* 主题覆盖）。
 *           本文件仅为 M1 过渡构建保留，禁止新增引用。

 */
import React, { useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Position,
  type Node as FlowNode,
  type Edge as FlowEdge,
  type NodeTypes,
  type EdgeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { WorkflowNodeCard } from "./node-card.js";
import { WorkflowBranchEdge } from "./edge-branch.js";
import { layoutNodes } from "./layout.js";
import type { WorkflowCanvasProps, NodeStateInfo } from "./types.js";

const DEFAULT_NODE_TYPES: NodeTypes = {
  workflowNode: WorkflowNodeCard,
};

const DEFAULT_EDGE_TYPES: EdgeTypes = {
  workflowBranch: WorkflowBranchEdge,
};

export const WorkflowCanvas: React.FC<WorkflowCanvasProps> = ({
  dsl,
  nodeStates,
  className,
  style,
  onNodeClick,
  fitView = true,
}) => {
  // 1. 计算拓扑分层布局
  const positions = useMemo(() => {
    return layoutNodes(dsl.nodes, dsl.edges);
  }, [dsl.nodes, dsl.edges]);

  // 2. 构造 React Flow 节点数据（包含显式 handles 描述以保证 SSR / headless / 测试环境下的精确边挂载）
  const flowNodes: FlowNode[] = useMemo(() => {
    return dsl.nodes.map((node) => {
      const stateObj = nodeStates?.[node.id];
      const status = stateObj?.status || "pending";
      const pos = positions.get(node.id) || { x: 0, y: 0 };

      const handles = [];
      if (node.type !== "start") {
        handles.push({
          type: "target" as const,
          position: Position.Top,
          x: 96,
          y: 0,
          width: 8,
          height: 8,
        });
      }
      if (node.type !== "end") {
        handles.push({
          type: "source" as const,
          position: Position.Bottom,
          x: 96,
          y: 90,
          width: 8,
          height: 8,
        });
      }

      return {
        id: node.id,
        type: "workflowNode",
        position: pos,
        width: 200,
        height: 90,
        measured: {
          width: 200,
          height: 90,
        },
        handles,
        data: {
          node,
          status,
          stateInfo: stateObj as NodeStateInfo | undefined,
          onNodeClick,
        },
      };
    });
  }, [dsl.nodes, nodeStates, positions, onNodeClick]);

  // 3. 构造 React Flow 连线数据（含 branch 标签）
  const flowEdges: FlowEdge[] = useMemo(() => {
    return dsl.edges.map((edge) => {
      const sourceStatus = nodeStates?.[edge.source]?.status;
      const isRunning = sourceStatus === "running";

      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        type: "workflowBranch",
        label: edge.branch,
        animated: isRunning,
        data: {
          branch: edge.branch,
        },
        style: {
          strokeWidth: 2,
          stroke: isRunning ? "#3b82f6" : "#94a3b8",
        },
      };
    });
  }, [dsl.edges, nodeStates]);

  return (
    <div
      className={`dsh-workflow-canvas-container ${className ?? ""}`}
      data-testid="workflow-canvas"
      style={{
        width: "100%",
        height: "100%",
        minHeight: "400px",
        backgroundColor: "#f8fafc",
        position: "relative",
        ...style,
      }}
    >
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={DEFAULT_NODE_TYPES}
        edgeTypes={DEFAULT_EDGE_TYPES}
        fitView={fitView}
        onlyRenderVisibleElements={false}
        nodesDraggable={true}
        nodesConnectable={false}
        elementsSelectable={true}
      >
        <Background gap={16} size={1} color="#e2e8f0" />
        <Controls />
        <MiniMap
          nodeColor={(node) => {
            const data = node.data as { status?: string } | undefined;
            const s = data?.status || "pending";
            switch (s) {
              case "running":
                return "#3b82f6";
              case "success":
                return "#10b981";
              case "failed":
                return "#ef4444";
              case "waiting_human":
                return "#f59e0b";
              case "skipped":
                return "#cbd5e1";
              default:
                return "#94a3b8";
            }
          }}
          style={{ height: 100, width: 140 }}
        />
      </ReactFlow>
    </div>
  );
};
