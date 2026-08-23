/**
 * @deprecated 自 M2 起废弃（§10.12 迁移清单）：布局已由 src/canvas-parts/layout-v2.ts
 *           接管（240px 卡宽、实测高度、废除 200×90 与钉死端口像素，§10.7）。
 *           本文件仅为旧测试与过渡构建保留，禁止新增引用。

 */
import type { WorkflowNode, WorkflowEdge } from "@dsh-workflow/schema";

export interface NodePosition {
  x: number;
  y: number;
}

export interface LayoutOptions {
  nodeWidth?: number;
  nodeHeight?: number;
  gapX?: number;
  gapY?: number;
  startX?: number;
  startY?: number;
}

const DEFAULT_OPTIONS: Required<LayoutOptions> = {
  nodeWidth: 200,
  nodeHeight: 90,
  gapX: 60,
  gapY: 90,
  startX: 400,
  startY: 50,
};

/**
 * 拓扑层级自动分层排布算法
 * 按有向图依赖关系计算节点的层级 (rank/level)，同一层级横向均分排布，跨层级纵向排布。
 * 纯算法实现，不依赖外部大型布局库。
 */
export function layoutNodes(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  options?: LayoutOptions
): Map<string, NodePosition> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const positions = new Map<string, NodePosition>();

  if (nodes.length === 0) {
    return positions;
  }

  const nodeMap = new Map<string, WorkflowNode>();
  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

  // 构建邻接表与入度
  const outEdges = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const node of nodes) {
    outEdges.set(node.id, []);
    inDegree.set(node.id, 0);
  }

  for (const edge of edges) {
    if (nodeMap.has(edge.source) && nodeMap.has(edge.target)) {
      outEdges.get(edge.source)!.push(edge.target);
      inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    }
  }

  const levels = new Map<string, number>();

  // 1. 寻找入度为 0 的节点作为第 0 层起点（如 start 节点）
  const queue: string[] = [];
  for (const node of nodes) {
    if (inDegree.get(node.id) === 0) {
      levels.set(node.id, 0);
      queue.push(node.id);
    }
  }

  // 若图中无入度为 0 的节点（如环图），选取第一个节点作为起点
  if (queue.length === 0 && nodes.length > 0) {
    const firstId = nodes[0].id;
    levels.set(firstId, 0);
    queue.push(firstId);
  }

  // 2. BFS / 拓扑推进计算最长路径层级
  let iterations = 0;
  const maxIterations = nodes.length * nodes.length + 10;

  while (queue.length > 0 && iterations < maxIterations) {
    iterations++;
    const currentId = queue.shift()!;
    const currentLevel = levels.get(currentId) ?? 0;
    const nextIds = outEdges.get(currentId) ?? [];

    for (const nextId of nextIds) {
      const targetLevel = currentLevel + 1;
      const existingLevel = levels.get(nextId);

      if (existingLevel === undefined || targetLevel > existingLevel) {
        levels.set(nextId, targetLevel);
        queue.push(nextId);
      }
    }
  }

  // 3. 兜底：处理未连通的孤立节点或未遍历到的节点
  let maxAssignedLevel = 0;
  for (const lvl of levels.values()) {
    if (lvl > maxAssignedLevel) maxAssignedLevel = lvl;
  }

  for (const node of nodes) {
    if (!levels.has(node.id)) {
      maxAssignedLevel++;
      levels.set(node.id, maxAssignedLevel);
    }
  }

  // 4. 按层级分组
  const levelGroups = new Map<number, WorkflowNode[]>();
  for (const node of nodes) {
    const lvl = levels.get(node.id) ?? 0;
    if (!levelGroups.has(lvl)) {
      levelGroups.set(lvl, []);
    }
    levelGroups.get(lvl)!.push(node);
  }

  // 5. 计算具体坐标 (x, y)
  const sortedLevels = Array.from(levelGroups.keys()).sort((a, b) => a - b);

  for (const lvl of sortedLevels) {
    const group = levelGroups.get(lvl)!;
    const count = group.length;
    const totalRowWidth = count * opts.nodeWidth + (count - 1) * opts.gapX;
    const rowStartX = opts.startX - totalRowWidth / 2 + opts.nodeWidth / 2;
    const y = opts.startY + lvl * (opts.nodeHeight + opts.gapY);

    group.forEach((node, idx) => {
      const x = rowStartX + idx * (opts.nodeWidth + opts.gapX);
      positions.set(node.id, { x, y });
    });
  }

  return positions;
}
