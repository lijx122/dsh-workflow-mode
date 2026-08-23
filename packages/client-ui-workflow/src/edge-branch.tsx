/**
 * @deprecated 自 M2 起废弃（§10.12 迁移清单）：分支边已由 src/canvas-parts/branch-edge.tsx
 *           接管（true/false 徽章走令牌化 tint）。本文件仅为 M1 过渡构建保留，
 *           禁止新增引用；新代码一律使用 canvas-parts/。

 */
import React from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";

export interface WorkflowEdgeData {
  branch?: string;
  [key: string]: unknown;
}

export const WorkflowBranchEdge: React.FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
  label,
}) => {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const branchLabel = (data as WorkflowEdgeData)?.branch || (label as string);

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />
      {branchLabel && (
        <EdgeLabelRenderer>
          <div
            className="workflow-edge-label-container"
            data-testid={`edge-label-${id}`}
            data-branch={branchLabel}
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              background: "#f8fafc",
              padding: "2px 6px",
              borderRadius: "4px",
              fontSize: "11px",
              fontWeight: 600,
              color: "#475569",
              border: "1px solid #cbd5e1",
              pointerEvents: "all",
              zIndex: 10,
            }}
          >
            <span className="branch-text">{branchLabel}</span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
};
