/**
 * @deprecated 自 M2 起废弃（§10.12 迁移清单）：节点卡职责已由 src/nodes/<type>/card.tsx
 *           （共享壳 src/nodes/shared/card-shell.tsx）接管。本文件仅为 M1 过渡构建保留，
 *           禁止新增引用；新代码一律使用 nodes/ 体系。M2 完成时按 §10.12 删除。

 */
import React from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { NodeType } from "@dsh-workflow/schema";
import { normalizeStatus, type NodeStatus, type WorkflowNodeData } from "./types.js";

/**
 * 节点类型图标映射
 */
export const NODE_TYPE_ICONS: Record<NodeType | string, string> = {
  start: "🚀",
  end: "🏁",
  if_else: "🔀",
  iteration: "🔄",
  human: "👤",
  llm: "🤖",
  subagent: "👥",
  code: "💻",
  template: "📝",
  set_variable: "🔧",
  plugin_tool: "🔌",
  switch: "🔀",
  wait: "⏱️",
  merge: "🔗",
  error_fallback: "🛡️",
  schedule_trigger: "⏰",
  webhook_trigger: "🌐",
  intent_classifier: "🎯",
  parameter_extractor: "🔍",
  sub_workflow: "📦",
  http_request: "🌍",
};

/**
 * 节点状态色与样式映射
 */
export const STATUS_STYLES: Record<
  string,
  {
    bg: string;
    border: string;
    text: string;
    badgeBg: string;
    badgeText: string;
  }
> = {
  pending: {
    bg: "#f9fafb",
    border: "#9ca3af",
    text: "#374151",
    badgeBg: "#e5e7eb",
    badgeText: "#4b5563",
  },
  running: {
    bg: "#eff6ff",
    border: "#3b82f6",
    text: "#1d4ed8",
    badgeBg: "#dbeafe",
    badgeText: "#1e40af",
  },
  success: {
    bg: "#ecfdf5",
    border: "#10b981",
    text: "#047857",
    badgeBg: "#d1fae5",
    badgeText: "#065f46",
  },
  failed: {
    bg: "#fef2f2",
    border: "#ef4444",
    text: "#b91c1c",
    badgeBg: "#fee2e2",
    badgeText: "#991b1b",
  },
  waiting_human: {
    bg: "#fffbeb",
    border: "#f59e0b",
    text: "#b45309",
    badgeBg: "#fef3c7",
    badgeText: "#92400e",
  },
  skipped: {
    bg: "#f3f4f6",
    border: "#d1d5db",
    text: "#9ca3af",
    badgeBg: "#e5e7eb",
    badgeText: "#9ca3af",
  },
};

export const WorkflowNodeCard: React.FC<NodeProps> = ({ id, data }) => {
  const nodeData = data as unknown as WorkflowNodeData;
  const node = nodeData.node;
  const status: NodeStatus = normalizeStatus(nodeData.status);
  const nodeType = node.type;
  const icon = NODE_TYPE_ICONS[nodeType] ?? "⚙️";
  const styles = STATUS_STYLES[status] ?? STATUS_STYLES.pending;
  const isSkipped = status === "skipped";

  return (
    <div
      className={`workflow-node-card status-${status} node-type-${nodeType}`}
      data-testid={`workflow-node-${id}`}
      data-node-id={id}
      data-node-type={nodeType}
      data-status={status}
      style={{
        padding: "10px 14px",
        borderRadius: "8px",
        border: `2px solid ${styles.border}`,
        backgroundColor: styles.bg,
        color: styles.text,
        minWidth: "180px",
        boxShadow: "0 2px 6px rgba(0,0,0,0.06)",
        fontFamily: "system-ui, -apple-system, sans-serif",
        opacity: isSkipped ? 0.6 : 1,
        transition: "all 0.2s ease-in-out",
        cursor: nodeData.onNodeClick ? "pointer" : "default",
      }}
      onClick={() => {
        if (nodeData.onNodeClick) {
          nodeData.onNodeClick(id, node);
        }
      }}
    >
      {/* Target Handle: top */}
      {nodeType !== "start" && (
        <Handle
          type="target"
          position={Position.Top}
          style={{ background: styles.border, width: 8, height: 8 }}
        />
      )}

      {/* Card Header: Icon + Type + Status Badge */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "6px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: "16px" }} role="img" aria-label={nodeType}>
            {icon}
          </span>
          <span
            className="node-type-label"
            style={{
              fontSize: "11px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              color: styles.text,
            }}
          >
            {nodeType}
          </span>
        </div>
        <span
          className={`status-badge status-${status}`}
          data-testid={`status-badge-${id}`}
          style={{
            fontSize: "10px",
            padding: "2px 6px",
            borderRadius: "4px",
            backgroundColor: styles.badgeBg,
            color: styles.badgeText,
            fontWeight: 600,
          }}
        >
          {status}
        </span>
      </div>

      {/* Card Body: Node ID & optional name */}
      <div style={{ fontSize: "13px", fontWeight: 600, wordBreak: "break-all" }}>
        <span className="node-id-label">{id}</span>
      </div>
      {node.name && node.name !== id && (
        <div
          className="node-name-label"
          style={{ fontSize: "11px", opacity: 0.8, marginTop: "2px" }}
        >
          {node.name}
        </div>
      )}

      {/* Source Handle: bottom */}
      {nodeType !== "end" && (
        <Handle
          type="source"
          position={Position.Bottom}
          style={{ background: styles.border, width: 8, height: 8 }}
        />
      )}
    </div>
  );
};
