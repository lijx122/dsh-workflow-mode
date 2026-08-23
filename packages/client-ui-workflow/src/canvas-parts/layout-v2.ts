/**
 * 画布布局 v2（M2，§10.7）。
 *
 * 职责接管自旧 src/layout.ts：
 * - 卡宽统一 240px、高自适应——优先消费 React Flow 实测尺寸（options.measured），
 *   未实测前按类型估算；废除旧 200×90 与钉死 y=90/x=96 像素常量；
 * - 端口位置不参与布局常量（handle 由卡片按 offsetRatio 动态定位）。
 * 纯函数实现，便于 jsdom 单测。
 */
import type { WorkflowNode, WorkflowEdge } from "@dsh-workflow/schema";

/** §10.7 节点卡片统一宽度。 */
export const NODE_CARD_WIDTH = 240;
/** 未实测时的兜底高度。 */
export const DEFAULT_NODE_HEIGHT = 72;

/** 按类型估算初始高度（实测前的近似值，仅影响首帧排布间距）。 */
export function estimateNodeHeight(type: string): number {
  switch (type) {
    case "llm":
      return 92;
    case "if_else":
    case "switch":
      return 84;
    case "start":
    case "end":
      return 64;
    default:
      return DEFAULT_NODE_HEIGHT;
  }
}

export interface MeasuredSize {
  width: number;
  height: number;
}

export interface LayoutV2Options {
  gapX?: number;
  gapY?: number;
  startX?: number;
  startY?: number;
  /** React Flow 实测尺寸表（存在则优先于估算值）。 */
  measured?: ReadonlyMap<string, MeasuredSize>;
}

const DEFAULTS = { gapX: 80, gapY: 90, startX: 400, startY: 60 };

function heightOf(node: WorkflowNode, options: LayoutV2Options): number {
  const m = options.measured?.get(node.id);
  const height = typeof m?.height === "number" && m.height > 0 ? m.height : estimateNodeHeight(node.type);
  return Math.max(48, height);
}

/**
 * 拓扑分层布局：最长路径定层，同层横向均分；
 * 层间纵向间距取该层最大实测/估算高度 + gapY。
 */
export function layoutNodesMeasured(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  options: LayoutV2Options = {},
): Map<string, { x: number; y: number }> {
  const opts = { ...DEFAULTS, ...options };
  const positions = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) return positions;

  const ids = new Set(nodes.map((n) => n.id));
  const outEdges = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const n of nodes) {
    outEdges.set(n.id, []);
    inDegree.set(n.id, 0);
  }
  for (const e of edges) {
    if (ids.has(e.source) && ids.has(e.target)) {
      outEdges.get(e.source)!.push(e.target);
      inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
    }
  }

  // 最长路径分层（BFS 松弛；环图由迭代上限兜底）。
  const levels = new Map<string, number>();
  const queue: string[] = [];
  for (const n of nodes) {
    if ((inDegree.get(n.id) ?? 0) === 0) {
      levels.set(n.id, 0);
      queue.push(n.id);
    }
  }
  if (queue.length === 0 && nodes.length > 0) {
    levels.set(nodes[0].id, 0);
    queue.push(nodes[0].id);
  }
  let guard = nodes.length * nodes.length + 10;
  while (queue.length > 0 && guard-- > 0) {
    const current = queue.shift()!;
    const level = levels.get(current) ?? 0;
    for (const next of outEdges.get(current) ?? []) {
      const candidate = level + 1;
      if ((levels.get(next) ?? -1) < candidate) {
        levels.set(next, candidate);
        queue.push(next);
      }
    }
  }
  // 孤立节点兜底成层。
  let maxLevel = 0;
  for (const lvl of levels.values()) maxLevel = Math.max(maxLevel, lvl);
  for (const n of nodes) {
    if (!levels.has(n.id)) levels.set(n.id, ++maxLevel);
  }

  // 分层分组。
  const groups = new Map<number, WorkflowNode[]>();
  for (const n of nodes) {
    const lvl = levels.get(n.id) ?? 0;
    if (!groups.has(lvl)) groups.set(lvl, []);
    groups.get(lvl)!.push(n);
  }

  // 坐标：行高按该层最大高度累积；行内以 startX 为中心横向均分。
  let cursorY = opts.startY;
  for (const lvl of [...groups.keys()].sort((a, b) => a - b)) {
    const group = groups.get(lvl)!;
    const rowHeight = Math.max(...group.map((n) => heightOf(n, options)));
    const totalWidth = group.length * NODE_CARD_WIDTH + (group.length - 1) * opts.gapX;
    const rowStartX = opts.startX - totalWidth / 2;
    group.forEach((n, i) => {
      positions.set(n.id, { x: rowStartX + i * (NODE_CARD_WIDTH + opts.gapX), y: cursorY });
    });
    cursorY += rowHeight + opts.gapY;
  }
  return positions;
}
