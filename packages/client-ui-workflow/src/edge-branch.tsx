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
