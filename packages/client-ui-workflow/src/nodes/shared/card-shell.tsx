/**
 * 节点卡片壳（M2 共享件）。
 * - 240px 宽、高自适应；左 3px 类型色条（--node-tag-color）；28px 图标 chip；
 *   右上类型徽章；11px 等宽副标题（§4.3 / §10.20 五要素）。
 * - 端口按 def.handles 规格渲染，offsetRatio 百分比动态定位（§10.7）。
 * - 六态 class 由上游归一化状态驱动（§10.8）。
 * - makeFlowCard：把 NodeCardProps 组件适配为 @xyflow/react 自定义节点组件。
 */
import React from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type {
  NodeCardProps,
  NodeDefinition,
  NodeMeta,
  NodeHandleSpec,
  WorkflowNodeData,
} from "../../types.js";
import { normalizeStatus } from "../../types.js";
import styles from "../../node-styles.module.css";

const POSITION_MAP = {
  left: Position.Left,
  right: Position.Right,
} as const;

function statusClassName(status: string): string {
  switch (status) {
    case "running": return styles.statusRunning;
    case "completed": return styles.statusCompleted;
    case "failed": return styles.statusFailed;
    case "skipped": return styles.statusSkipped;
    case "waiting_human": return styles.statusWaitingHuman;
    default: return styles.statusPending;
  }
}

function renderHandle(spec: NodeHandleSpec, key: string): React.ReactNode {
  const position = POSITION_MAP[spec.position ?? (spec.kind === "target" ? "left" : "right")];
  const style: React.CSSProperties =
    spec.offsetRatio === undefined ? {} : { top: `${Math.round(spec.offsetRatio * 100)}%` };
  return (
    <Handle
      key={key}
      type={spec.kind}
      position={position}
      id={spec.id}
      isConnectable={false}
      style={style}
    />
  );
}

export interface BaseNodeCardProps extends NodeCardProps {
  def: NodeMeta;
  /** 类型专属附加内容（如 llm 卡内模型小字）。 */
  children?: React.ReactNode;
}

export function BaseNodeCard({ def, node, selected, status, stateInfo, onClick, children }: BaseNodeCardProps) {
  const handles = def.handles ?? [
    ...(node.type !== "start" ? [{ kind: "target" as const }] : []),
    ...(node.type !== "end" ? [{ kind: "source" as const }] : []),
  ];
  const badgeText = def.badgeText ?? def.type.toUpperCase();
  const subtitle = def.subtitle?.(node);
  return (
    <div
      className={[
        styles.card,
        statusClassName(status),
        selected ? styles.selected : "",
      ].filter(Boolean).join(" ")}
      style={{ "--node-tag-color": def.colorToken } as React.CSSProperties}
      data-node-id={node.id}
      data-node-type={def.type}
      data-status={status}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(node.id, node);
      }}
    >
      {handles.map((h, i) => renderHandle(h, `${h.kind}-${h.id ?? i}`))}
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <div className={styles.chip} aria-hidden="true">{def.icon}</div>
          <span className={styles.name}>{node.name || node.id}</span>
        </div>
        <span className={styles.badge}>{badgeText}</span>
      </div>
      {subtitle !== undefined && subtitle !== "" && (
        <div className={styles.subtext}>{subtitle}</div>
      )}
      {children}
      {status === "failed" && stateInfo?.error && (
        <div className={styles.errText} title={stateInfo.error}>{stateInfo.error}</div>
      )}
      {status === "waiting_human" && (
        <span className={styles.waitingBadge} title="等待人工审批">👤</span>
      )}
    </div>
  );
}

/**
 * 把某类型的 NodeCardProps 组件包装为 xyflow 节点组件。
 * 数据经 WorkflowNodeData 形状传入；缺省/未知形状一律回落 pending 态空卡。
 */
export function makeFlowCard(def: NodeDefinition): React.ComponentType<NodeProps> {
  function FlowCard(props: NodeProps) {
    const data = (props.data ?? {}) as Partial<WorkflowNodeData>;
    const node = data.node;
    if (!node) return null;
    const CardComponent = def.CardComponent;
    return (
      <CardComponent
        node={node}
        selected={props.selected}
        status={normalizeStatus(data.status)}
        stateInfo={data.stateInfo}
        onClick={data.onNodeClick}
      />
    );
  }
  FlowCard.displayName = `FlowCard_${def.type}`;
  return FlowCard;
}

/** 截断工具：卡片副标题防溢出的最后防线（CSS ellipsis 之外的语义截断）。 */
export function truncate(text: string, max = 40): string {
  const clean = text.replace(/[\r\n]+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max - 1) + "…" : clean;
}
