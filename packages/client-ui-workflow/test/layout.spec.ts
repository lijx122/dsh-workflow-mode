import { describe, it, expect } from "vitest";
import { layoutNodes } from "../src/layout.js";
import type { WorkflowNode, WorkflowEdge } from "@dsh-workflow/schema";

describe("layoutNodes", () => {
  it("should handle empty nodes and edges", () => {
    const positions = layoutNodes([], []);
    expect(positions.size).toBe(0);
  });

  it("should correctly calculate hierarchical levels for a sequential pipeline", () => {
    const nodes: WorkflowNode[] = [
      { id: "start", type: "start" },
      { id: "step1", type: "code", code: "return 1;" },
      { id: "step2", type: "llm", prompt: "hello" },
      { id: "end", type: "end" },
    ];
    const edges: WorkflowEdge[] = [
      { id: "e1", source: "start", target: "step1" },
      { id: "e2", source: "step1", target: "step2" },
      { id: "e3", source: "step2", target: "end" },
    ];

    const positions = layoutNodes(nodes, edges);
    expect(positions.size).toBe(4);

    const posStart = positions.get("start")!;
    const posStep1 = positions.get("step1")!;
    const posStep2 = positions.get("step2")!;
    const posEnd = positions.get("end")!;

    expect(posStart.y).toBeLessThan(posStep1.y);
    expect(posStep1.y).toBeLessThan(posStep2.y);
    expect(posStep2.y).toBeLessThan(posEnd.y);
  });

  it("should place branching nodes in the same level horizontally", () => {
    const nodes: WorkflowNode[] = [
      { id: "start", type: "start" },
      { id: "if_node", type: "if_else", condition: "true" },
      { id: "branch_a", type: "code", code: "1" },
      { id: "branch_b", type: "code", code: "2" },
      { id: "merge_node", type: "merge" },
    ];
    const edges: WorkflowEdge[] = [
      { id: "e1", source: "start", target: "if_node" },
      { id: "e2", source: "if_node", target: "branch_a", branch: "true" },
      { id: "e3", source: "if_node", target: "branch_b", branch: "false" },
      { id: "e4", source: "branch_a", target: "merge_node" },
      { id: "e5", source: "branch_b", target: "merge_node" },
    ];

    const positions = layoutNodes(nodes, edges);

    const posBranchA = positions.get("branch_a")!;
    const posBranchB = positions.get("branch_b")!;

    // branch_a and branch_b should be at the same vertical level (y)
    expect(posBranchA.y).toBe(posBranchB.y);
    // branch_a and branch_b should have different horizontal coordinates (x)
    expect(posBranchA.x).not.toBe(posBranchB.x);

    const posIf = positions.get("if_node")!;
    const posMerge = positions.get("merge_node")!;

    expect(posIf.y).toBeLessThan(posBranchA.y);
    expect(posBranchA.y).toBeLessThan(posMerge.y);
  });

  it("should handle isolated nodes without crashing", () => {
    const nodes: WorkflowNode[] = [
      { id: "node1", type: "start" },
      { id: "node2", type: "end" },
      { id: "isolated", type: "human", prompt: "approve" },
    ];
    const edges: WorkflowEdge[] = [
      { id: "e1", source: "node1", target: "node2" },
    ];

    const positions = layoutNodes(nodes, edges);
    expect(positions.size).toBe(3);
    expect(positions.has("isolated")).toBe(true);
  });

  it("should handle cyclic graphs safely without infinite loops", () => {
    const nodes: WorkflowNode[] = [
      { id: "a", type: "code", code: "1" },
      { id: "b", type: "code", code: "2" },
    ];
    const edges: WorkflowEdge[] = [
      { id: "e1", source: "a", target: "b" },
      { id: "e2", source: "b", target: "a" },
    ];

    const positions = layoutNodes(nodes, edges);
    expect(positions.size).toBe(2);
  });
});
