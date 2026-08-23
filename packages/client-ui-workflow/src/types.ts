/**
 * Workflow Studio 共享类型（M2 统一维护）。
 *
 * 规范来源：docs/design/workflow-studio-design.md
 * - §10.8：全量状态枚举 pending/running/completed/failed/skipped/waiting_human，
 *   旧字样 success 一律迁移为 completed（normalizeStatus 兜底）。
 * - 共享接口冻结：NodeStateInfo 形状 { status, outputs?, durationMs?, error? }。
 * - §3.5 / §4.2 / §10.20：NodeDefinition 五要素（label/icon/colorToken/副标题/面板）。
 * - §10.7：端口以 offsetRatio 动态定位，废除钉死 y=90/x=96 像素常量。
 */
import type { ComponentType, CSSProperties } from "react";
import type { WorkflowDSL, WorkflowNode, WorkflowEdge, NodeType } from "@dsh-workflow/schema";

/* ============ §10.8 全量状态枚举（唯一真相源） ============ */

export const NODE_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
  "waiting_human",
] as const;

export type NodeStatus = (typeof NODE_STATUSES)[number];

/**
 * 状态归一化（§10.8 迁移条款）：success → completed；
 * 未知/缺席值一律回落 pending。画布与面板只消费归一化结果。
 */
export function normalizeStatus(status: unknown): NodeStatus {
  if (status === "success") return "completed";
  return (NODE_STATUSES as readonly string[]).includes(status as string)
    ? (status as NodeStatus)
    : "pending";
}

/** 状态中文标签（卡片角标 / 日志复用）。 */
export const STATUS_META: Record<NodeStatus, { label: string }> = {
  pending: { label: "待执行" },
  running: { label: "执行中" },
  completed: { label: "已完成" },
  failed: { label: "失败" },
  skipped: { label: "已跳过" },
  waiting_human: { label: "等待人工" },
};

/** 共享冻结契约：节点运行状态信息（不得擅改形状）。 */
export interface NodeStateInfo {
  status: NodeStatus;
  outputs?: Record<string, unknown>;
  durationMs?: number;
  error?: string;
}

/* ============ 节点分组（block-selector 三分组） ============ */

export type NodeGroup = "logic" | "ai" | "transform";

export const NODE_GROUP_TITLES: Record<NodeGroup, string> = {
  logic: "逻辑控制",
  ai: "AI 能力",
  transform: "转换处理",
};

/* ============ 端口规格（§10.7 动态定位） ============ */

export interface NodeHandleSpec {
  kind: "target" | "source";
  /** source 分支句柄 id（if_else/switch 的 true/false）。 */
  id?: string;
  /** 缺省：target=left、source=right。 */
  position?: "left" | "right";
  /** 沿边 0-1 百分比定位；缺省垂直居中。禁止钉死像素。 */
  offsetRatio?: number;
  /** 端口旁的小字标签（T/F 等）。 */
  label?: string;
}

/* ============ 面板上下文（§10.1 模型降级探测） ============ */

export interface ModelOption {
  id: string;
  label: string;
}

export interface ModelCatalogSnapshot {
  available: boolean;
  models: ModelOption[];
  source: "dsh-client-ui-model-selection" | "unavailable";
}

export interface NodePanelContext {
  modelCatalog?: ModelCatalogSnapshot;
  /** 会话当前模型 id（降级只读展示用）。 */
  sessionModelId?: string;
}

/* ============ 卡片 / 面板 / 定义 ============ */

export interface NodeCardProps {
  node: WorkflowNode;
  selected?: boolean;
  /** 已归一化的状态（上游负责 normalizeStatus）。 */
  status: NodeStatus;
  stateInfo?: NodeStateInfo;
  onClick?(nodeId: string, node: WorkflowNode): void;
}

export interface NodePanelProps<P extends WorkflowNode = WorkflowNode> {
  node: P;
  onChange(patch: Partial<P>): void;
  runState?: NodeStateInfo;
  context?: NodePanelContext;
}

/**
 * 节点定义（NODE_REGISTRY 条目，§4.1 Dify 四件套收敛形态）：
 * default.ts 元数据 + defaultFactory + checkValid + subtitle，
 * card.tsx / panel.tsx 组件在 nodes/<type>/index.ts 组装注入。
 */
export interface NodeDefinition {
  type: NodeType;
  label: string;
  icon: string;
  /** 类型识别色：CSS 变量或扩展调色板 hex（§3.5，禁用已否决的靛紫色族）。 */
  colorToken: string;
  group: NodeGroup;
  /** 右上角徽章文本；缺省取 type 大写。 */
  badgeText?: string;
  defaultFactory(id: string): WorkflowNode;
  /** 合法返回 null，否则返回可展示的错误信息。 */
  checkValid(node: WorkflowNode): string | null;
  /** 卡片第二行 11px 等宽副标题。 */
  subtitle?(node: WorkflowNode): string;
  /** 缺省 = 左入右出单端口（§10.7 动态布局）。 */
  handles?: NodeHandleSpec[];
  CardComponent: ComponentType<NodeCardProps>;
  PanelComponent: ComponentType<NodePanelProps<any>>;
}

/** 定义元数据子集：nodes/<type>/default.ts 持有，index.ts 注入组件后成完整 NodeDefinition。 */
export type NodeMeta = Omit<NodeDefinition, "CardComponent" | "PanelComponent">;

/* ============ 旧画布数据形状（过渡期兼容保留，§10.12 迁移完成后移除） ============ */

export interface WorkflowNodeData extends Record<string, unknown> {
  node: WorkflowNode;
  status?: NodeStatus | string;
  stateInfo?: NodeStateInfo;
  onNodeClick?: (nodeId: string, node: WorkflowNode) => void;
}

export interface WorkflowCanvasProps {
  dsl: WorkflowDSL;
  nodeStates?: Record<string, NodeStateInfo | { status: string }>;
  className?: string;
  style?: CSSProperties;
  onNodeClick?: (nodeId: string, node: WorkflowNode) => void;
  fitView?: boolean;
}

export type { WorkflowDSL, WorkflowNode, WorkflowEdge, NodeType };
