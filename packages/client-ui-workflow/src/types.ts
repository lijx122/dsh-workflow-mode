import type { WorkflowDSL, WorkflowNode, WorkflowEdge, NodeType } from "@dsh-workflow/schema";

export type NodeStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "waiting_human"
  | "skipped"
  | string;

export interface NodeStateInfo {
  status: NodeStatus;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  outputs?: Record<string, unknown>;
  waitingData?: unknown;
}

export interface WorkflowNodeData extends Record<string, unknown> {
  node: WorkflowNode;
  status: NodeStatus;
  stateInfo?: NodeStateInfo;
  onNodeClick?: (nodeId: string, node: WorkflowNode) => void;
}

export interface WorkflowCanvasProps {
  dsl: WorkflowDSL;
  nodeStates?: Record<string, NodeStateInfo | { status: string }>;
  className?: string;
  style?: React.CSSProperties;
  onNodeClick?: (nodeId: string, node: WorkflowNode) => void;
  fitView?: boolean;
}

export type { WorkflowDSL, WorkflowNode, WorkflowEdge, NodeType };
