import { describe, it, expect } from "vitest";
import type { WorkflowNode, WorkflowEdge } from "@dsh-workflow/schema";
import {
  layoutNodesMeasured,
  estimateNodeHeight,
  NODE_CARD_WIDTH,
} from "../src/canvas-parts/layout-v2.js";

const chain = (n: number): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } => {
  const nodes = Array.from({ length: n }, (_, i) =>
    ({ id: "n" + i, type: i % 2 === 0 ? ("start" as const) : ("llm" as const) }),
  );
  const edges = Array.from({ length: n - 1 }, (_, i) => ({ id: "e" + i, source: "n" + i, target: "n" + (i + 1) }));
  return { nodes, edges };
};

describe("layout v2（§10.7）", () => {
  it("卡宽常量为 240 且不再有 200×90 常量残留", () => {
    expect(NODE_CARD_WIDTH).toBe(240);
  });

  it("顺序链逐层下移（单节点行居中：x 恒定、y 递增）", () => {
    const { nodes, edges } = chain(4);
    const pos = layoutNodesMeasured(nodes, edges);
    expect(pos.size).toBe(4);
    const xs = nodes.map((n) => pos.get(n.id)!.x);
    const ys = nodes.map((n) => pos.get(n.id)!.y);
    // 单节点层以 startX 居中 → x 全等；层级沿 y 递增。
    expect(new Set(xs).size).toBe(1);
    expect(ys[0]).toBeLessThan(ys[1]);
    expect(ys[1]).toBeLessThan(ys[2]);
    expect(ys[2]).toBeLessThan(ys[3]);
  });

  it("多节点同层横向等差展开（间距 = 卡宽 + gapX）", () => {
    const nodes: WorkflowNode[] = [
      { id: "a", type: "template", template: "x" },
      { id: "b", type: "template", template: "y" },
      { id: "c", type: "merge" },
    ];
    const edges: WorkflowEdge[] = [
      { id: "e1", source: "a", target: "c" },
      { id: "e2", source: "b", target: "c" },
    ];
    const pos = layoutNodesMeasured(nodes, edges, { gapX: 80 });
    expect(pos.get("b")!.x - pos.get("a")!.x).toBe(NODE_CARD_WIDTH + 80);
  });

  it("分支同层横向排布，merge 层级更深；实测高度优先于估算", () => {
    const nodes: WorkflowNode[] = [
      { id: "s", type: "start" },
      { id: "cond", type: "if_else", condition: "a>0" },
      { id: "a", type: "template", template: "x" },
      { id: "b", type: "template", template: "y" },
      { id: "m", type: "merge" },
    ];
    const edges: WorkflowEdge[] = [
      { id: "e1", source: "s", target: "cond" },
      { id: "e2", source: "cond", target: "a", branch: "true" },
      { id: "e3", source: "cond", target: "b", branch: "false" },
      { id: "e4", source: "a", target: "m" },
      { id: "e5", source: "b", target: "m" },
    ];
    const measured = new Map([["a", { width: 240, height: 300 }]]);
    const pos = layoutNodesMeasured(nodes, edges, { measured });
    expect(pos.get("a")!.y).toBe(pos.get("b")!.y);
    expect(pos.get("a")!.x).not.toBe(pos.get("b")!.x);
    // 实测高度 300 抬高行距：下一层 y 至少间隔 300 + 默认 gapY。
    expect(pos.get("m")!.y - pos.get("a")!.y).toBeGreaterThanOrEqual(300);
  });

  it("estimateNodeHeight 覆盖 llm/if_else/start 与默认值", () => {
    expect(estimateNodeHeight("llm")).toBeGreaterThan(estimateNodeHeight("start"));
    expect(estimateNodeHeight("unknown_type")).toBeGreaterThan(0);
  });

  it("环图与空图安全", () => {
    expect(layoutNodesMeasured([], []).size).toBe(0);
    const cyclic = layoutNodesMeasured(
      [{ id: "a", type: "start" }, { id: "b", type: "end" }],
      [{ id: "e1", source: "a", target: "b" }, { id: "e2", source: "b", target: "a" }],
    );
    expect(cyclic.size).toBe(2);
  });
});
