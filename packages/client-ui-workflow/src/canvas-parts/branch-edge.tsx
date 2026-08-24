/**
 * 分支边（M2 接管旧 src/edge-branch.tsx）：
 * 默认虚线弱色；source running 时品牌蓝加粗；分支边挂 true/false 徽章
 * （success/warn tint 底，预计算 rgba，§10.15 禁 color-mix）。
 */
import React from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";
import styles from "../node-styles.module.css";

export interface StudioEdgeData {
  branch?: string;
  active?: boolean;
  [key: string]: unknown;
}

export const StudioBranchEdge: React.FC<EdgeProps> = ({
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
}) => {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const branch = (data as StudioEdgeData | undefined)?.branch;
  const active = (data as StudioEdgeData | undefined)?.active === true;

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        className={active ? styles.edgeActive : undefined}
        style={{
          stroke: active ? "var(--dsw-alias-state-business-primary)" : "var(--dsw-alias-label-tertiary)",
          strokeWidth: active ? 2.5 : 2,
          strokeDasharray: active ? "5 3" : undefined,
          ...style,
        }}
      />
      {branch !== undefined && branch !== "" && (
        <EdgeLabelRenderer>
          <div
            className={
              styles.edgeBadge + " " + (branch === "true" ? styles.edgeBadgeTrue : styles.edgeBadgeFalse)
            }
            data-testid={"edge-label-" + id}
            data-branch={branch}
            style={{ transform: "translate(-50%, -50%) translate(" + labelX + "px," + labelY + "px)" }}
          >
            {branch}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
};
