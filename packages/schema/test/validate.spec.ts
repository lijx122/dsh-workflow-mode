import { describe, it, expect } from "vitest";
import { validateWorkflow, WorkflowDSL } from "../src/index.js";

describe("validateWorkflow", () => {
  it("合法最小图（start→end）validate 通过 ok:true", () => {
    const dsl: WorkflowDSL = {
      version: "dsh.workflow.v1",
      name: "minimal_flow",
      nodes: [
        { id: "start_node", type: "start" },
        { id: "end_node", type: "end" },
      ],
      edges: [
        {
          id: "e1",
          source: "start_node",
          target: "end_node",
        },
      ],
    };

    const res = validateWorkflow(dsl);
    expect(res.ok).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it("顶层非对象或缺版本/名称 → SCHEMA 错误且 path 可定位", () => {
    const invalidObj = {
      version: "wrong.version",
      // missing name
      nodes: "not an array",
      edges: null,
    };

    const res = validateWorkflow(invalidObj);
    expect(res.ok).toBe(false);
    const codes = res.errors.map((e) => e.code);
    expect(codes).toContain("SCHEMA");

    const paths = res.errors.map((e) => e.path);
    expect(paths).toContain("version");
    expect(paths).toContain("name");
    expect(paths).toContain("nodes");
    expect(paths).toContain("edges");
  });

  it("节点缺专有必填字段（如 if_else 缺 condition，human 缺 prompt） → SCHEMA 错误且 path 可定位", () => {
    const dsl = {
      version: "dsh.workflow.v1",
      name: "missing_fields_flow",
      nodes: [
        { id: "node1", type: "if_else" }, // missing condition
        { id: "node2", type: "human" }, // missing prompt
        { id: "node3", type: "code" }, // missing code
        { id: "node4", type: "set_variable" }, // missing assignments
      ],
      edges: [],
    };

    const res = validateWorkflow(dsl);
    expect(res.ok).toBe(false);

    const schemaErrors = res.errors.filter((e) => e.code === "SCHEMA");
    expect(schemaErrors.some((e) => e.path.startsWith("nodes[0]"))).toBe(true);
    expect(schemaErrors.some((e) => e.path.startsWith("nodes[1]"))).toBe(true);
    expect(schemaErrors.some((e) => e.path.startsWith("nodes[2]"))).toBe(true);
    expect(schemaErrors.some((e) => e.path.startsWith("nodes[3]"))).toBe(true);
  });

  it("悬空连线 → DANGLING_EDGE 且精确标明 source 或 target", () => {
    const dsl = {
      version: "dsh.workflow.v1",
      name: "dangling_edge_flow",
      nodes: [
        { id: "start_node", type: "start" },
        { id: "end_node", type: "end" },
      ],
      edges: [
        {
          id: "e1",
          source: "non_existent_node",
          target: "end_node",
        },
        {
          id: "e2",
          source: "start_node",
          target: "ghost_node",
        },
      ],
    };

    const res = validateWorkflow(dsl);
    expect(res.ok).toBe(false);
    const danglingErrors = res.errors.filter((e) => e.code === "DANGLING_EDGE");
    expect(danglingErrors.length).toBe(2);
    expect(danglingErrors[0].path).toBe("edges[0].source");
    expect(danglingErrors[1].path).toBe("edges[1].target");
  });

  it("两节点互相成环 → CYCLE 错误", () => {
    const dsl = {
      version: "dsh.workflow.v1",
      name: "cycle_flow",
      nodes: [
        { id: "node_a", type: "code", code: "return 1;" },
        { id: "node_b", type: "code", code: "return 2;" },
      ],
      edges: [
        { id: "e1", source: "node_a", target: "node_b" },
        { id: "e2", source: "node_b", target: "node_a" },
      ],
    };

    const res = validateWorkflow(dsl);
    expect(res.ok).toBe(false);
    const cycleErrors = res.errors.filter((e) => e.code === "CYCLE");
    expect(cycleErrors.length).toBeGreaterThanOrEqual(1);
    expect(cycleErrors[0].message).toContain("node_a");
    expect(cycleErrors[0].message).toContain("node_b");
  });

  it("重名 id → DUPLICATE_NODE_ID；非法 id（如 'git-clone'）→ INVALID_NODE_ID", () => {
    const dsl = {
      version: "dsh.workflow.v1",
      name: "invalid_ids_flow",
      nodes: [
        { id: "git-clone", type: "code", code: "return 1;" }, // invalid id with dash
        { id: "123_invalid", type: "code", code: "return 2;" }, // invalid starting with digit
        { id: "dup_node", type: "code", code: "return 3;" },
        { id: "dup_node", type: "code", code: "return 4;" }, // duplicate id
      ],
      edges: [],
    };

    const res = validateWorkflow(dsl);
    expect(res.ok).toBe(false);

    const invalidIdErrors = res.errors.filter((e) => e.code === "INVALID_NODE_ID");
    expect(invalidIdErrors.some((e) => e.path === "nodes[0].id")).toBe(true);
    expect(invalidIdErrors.some((e) => e.path === "nodes[1].id")).toBe(true);

    const dupIdErrors = res.errors.filter((e) => e.code === "DUPLICATE_NODE_ID");
    expect(dupIdErrors.some((e) => e.path === "nodes[3].id")).toBe(true);
  });

  it("未登记 type → UNKNOWN_NODE_TYPE", () => {
    const dsl = {
      version: "dsh.workflow.v1",
      name: "unknown_type_flow",
      nodes: [
        { id: "valid_start", type: "start" },
        { id: "strange_node", type: "some_unregistered_custom_type" },
      ],
      edges: [],
    };

    const res = validateWorkflow(dsl);
    expect(res.ok).toBe(false);
    const unknownErrors = res.errors.filter((e) => e.code === "UNKNOWN_NODE_TYPE");
    expect(unknownErrors).toHaveLength(1);
    expect(unknownErrors[0].path).toBe("nodes[1].type");
    expect(unknownErrors[0].message).toContain("some_unregistered_custom_type");
  });

  it("多错误累积返回（不遇错即停）", () => {
    const dsl = {
      version: "dsh.workflow.v1",
      name: "multi_error_flow",
      nodes: [
        { id: "bad-id-1", type: "unknown_node" }, // INVALID_NODE_ID + UNKNOWN_NODE_TYPE
        { id: "node_2", type: "if_else" }, // SCHEMA (missing condition)
        { id: "node_2", type: "human" }, // DUPLICATE_NODE_ID + SCHEMA (missing prompt)
      ],
      edges: [
        { id: "e1", source: "bad-id-1", target: "ghost_node" }, // DANGLING_EDGE
      ],
    };

    const res = validateWorkflow(dsl);
    expect(res.ok).toBe(false);
    const codes = new Set(res.errors.map((e) => e.code));

    expect(codes.has("INVALID_NODE_ID")).toBe(true);
    expect(codes.has("UNKNOWN_NODE_TYPE")).toBe(true);
    expect(codes.has("SCHEMA")).toBe(true);
    expect(codes.has("DUPLICATE_NODE_ID")).toBe(true);
    expect(codes.has("DANGLING_EDGE")).toBe(true);
  });
});
