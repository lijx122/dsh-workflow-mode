import { describe, it, expect } from "vitest";
import { validateWorkflow } from "../src/index.js";

describe("validateWorkflow", () => {
  it("合法最小图（start→end）validate 通过 ok:true", () => {
    const dsl = {
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

  it("name 为纯空格字符串 → SCHEMA 错误且 path === \"name\" (T2)", () => {
    const dsl = {
      version: "dsh.workflow.v1",
      name: "   ",
      nodes: [],
      edges: [],
    };

    const res = validateWorkflow(dsl);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.code === "SCHEMA" && e.path === "name")).toBe(true);
  });

  it("节点缺专有必填字段 → SCHEMA 错误且 path 精确到字段 (S2)", () => {
    const dsl = {
      version: "dsh.workflow.v1",
      name: "missing_fields_flow",
      nodes: [
        { id: "node1", type: "if_else" },       // missing condition
        { id: "node2", type: "human" },         // missing prompt
        { id: "node3", type: "code" },          // missing code
        { id: "node4", type: "set_variable" },  // missing assignments
      ],
      edges: [],
    };

    const res = validateWorkflow(dsl);
    expect(res.ok).toBe(false);

    const schemaErrors = res.errors.filter((e) => e.code === "SCHEMA");
    const pick = (i: number) => schemaErrors.filter((e) => e.path.startsWith(`nodes[${i}]`)).map((e) => e.path);

    expect(pick(0)).toContain("nodes[0].condition");
    expect(pick(1)).toContain("nodes[1].prompt");
    expect(pick(2)).toContain("nodes[2].code");
    expect(pick(3)).toContain("nodes[3].assignments");
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

  it("两节点互相成环 → CYCLE 错误, 精确环路径与闭合边 (S2/R5)", () => {
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
    expect(cycleErrors).toHaveLength(1);
    expect(cycleErrors[0].path).toBe("edges[1]");
    expect(cycleErrors[0].message).toBe("Workflow contains a cycle: node_a -> node_b -> node_a");
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

  it("多错误累积返回（不遇错即停）且 path 精确到字段 (S2)", () => {
    const dsl = {
      version: "dsh.workflow.v1",
      name: "multi_error_flow",
      nodes: [
        { id: "bad-id-1", type: "unknown_node" }, // INVALID_NODE_ID + UNKNOWN_NODE_TYPE
        { id: "node_2", type: "if_else" },       // SCHEMA (missing condition)
        { id: "node_2", type: "human" },         // DUPLICATE_NODE_ID + SCHEMA (missing prompt)
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

    // 精确断言每类错误的首个生效路径 (S2)
    expect(res.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "nodes[0].id", code: "INVALID_NODE_ID" }),
      expect.objectContaining({ path: "nodes[0].type", code: "UNKNOWN_NODE_TYPE" }),
      expect.objectContaining({ path: "nodes[1].condition", code: "SCHEMA" }),
      expect.objectContaining({ path: "nodes[2].id", code: "DUPLICATE_NODE_ID" }),
      expect.objectContaining({ path: "edges[0].target", code: "DANGLING_EDGE" }),
    ]));
  });

  it("自环 A→A → CYCLE 且完整环路径 (S2)", () => {
    const dsl = {
      version: "dsh.workflow.v1",
      name: "self_loop_flow",
      nodes: [
        { id: "node_a", type: "code", code: "return 1;" },
      ],
      edges: [
        { id: "e1", source: "node_a", target: "node_a" },
      ],
    };

    const res = validateWorkflow(dsl);
    expect(res.ok).toBe(false);
    const cycleErrors = res.errors.filter((e) => e.code === "CYCLE");
    expect(cycleErrors).toHaveLength(1);
    expect(cycleErrors[0].path).toBe("edges[0]");
    expect(cycleErrors[0].message).toBe("Workflow contains a cycle: node_a -> node_a");
  });

  it("同分量双环并存 → 两个 CYCLE 全部报告且无假环 (S1/S2)", () => {
    const dsl = {
      version: "dsh.workflow.v1",
      name: "dual_cycle_flow",
      nodes: [
        { id: "node_a", type: "code", code: "return 1;" },
        { id: "node_b", type: "code", code: "return 2;" },
        { id: "node_c", type: "code", code: "return 3;" },
      ],
      edges: [
        { id: "e1", source: "node_a", target: "node_b" },
        { id: "e2", source: "node_b", target: "node_a" },
        { id: "e3", source: "node_a", target: "node_c" },
        { id: "e4", source: "node_c", target: "node_a" },
      ],
    };

    const res = validateWorkflow(dsl);
    expect(res.ok).toBe(false);
    const cycleErrors = res.errors.filter((e) => e.code === "CYCLE");
    expect(cycleErrors).toHaveLength(2);
    expect(cycleErrors.map((e) => e.path).sort()).toEqual(["edges[1]", "edges[3]"]);
    expect(cycleErrors.map((e) => e.message).sort()).toEqual([
      "Workflow contains a cycle: node_a -> node_b -> node_a",
      "Workflow contains a cycle: node_a -> node_c -> node_a",
    ]);
  });

  it("嵌套数组路径与 JSON Pointer 转义 (assignments[0].key / inputs.a/b.type) (R4/S2)", () => {
    const dsl = {
      version: "dsh.workflow.v1",
      name: "nested_path_flow",
      nodes: [
        { id: "sv_node", type: "set_variable", assignments: [{ value: "return 1;" }] },              // 缺 key
        { id: "st_node", type: "start", inputs: { "a/b": { type: "not_a_valid_input_type" } } },     // 非法 input type, key 含 "/"
      ],
      edges: [],
    };

    const res = validateWorkflow(dsl);
    expect(res.ok).toBe(false);
    const schemaErrors = res.errors.filter((e) => e.code === "SCHEMA");
    expect(schemaErrors.some((e) => e.path === "nodes[0].assignments[0].key")).toBe(true);
    expect(schemaErrors.some((e) => e.path === "nodes[1].inputs.a/b.type")).toBe(true);
  });

  it("id 缺失 → 仅报一次 INVALID_NODE_ID，不重复报 SCHEMA /id (R6)", () => {
    const dsl = {
      version: "dsh.workflow.v1",
      name: "missing_id_flow",
      nodes: [
        { id: "ok_start", type: "start" },
        { type: "end" }, // 缺 id
      ],
      edges: [],
    };

    const res = validateWorkflow(dsl);
    expect(res.ok).toBe(false);
    const idErrors = res.errors.filter((e) => e.path === "nodes[1].id");
    expect(idErrors).toHaveLength(1);
    expect(idErrors[0].code).toBe("INVALID_NODE_ID");
  });

  it("retry 负数 → SCHEMA（RetryConfig 数字分支 minimum:0）(R7)", () => {
    const dsl = {
      version: "dsh.workflow.v1",
      name: "retry_negative_flow",
      nodes: [
        { id: "llm1", type: "llm", prompt: "hello", retry: -1 },
      ],
      edges: [],
    };

    const res = validateWorkflow(dsl);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.code === "SCHEMA" && e.path === "nodes[0].retry")).toBe(true);
  });

  it("P1 节点专有字段验证：10 种 P1 节点合法 DSL validate 通过 ok:true", () => {
    const dsl = {
      version: "dsh.workflow.v1",
      name: "all_p1_nodes_flow",
      nodes: [
        { id: "start_node", type: "start" },
        { id: "switch_node", type: "switch", cases: [{ when: "1 > 0", value: "ok" }], defaultCase: "fallback" },
        { id: "wait_node", type: "wait", waitMs: 100 },
        { id: "merge_node", type: "merge", strategy: "deep" },
        { id: "error_fallback_node", type: "error_fallback" },
        { id: "schedule_trigger_node", type: "schedule_trigger", cron: "0 * * * *" },
        { id: "webhook_trigger_node", type: "webhook_trigger", name: "hook1" },
        { id: "intent_classifier_node", type: "intent_classifier", prompt: "classify this", categories: ["a", "b"] },
        { id: "parameter_extractor_node", type: "parameter_extractor", prompt: "extract this", schema: { type: "object" } },
        { id: "sub_workflow_node", type: "sub_workflow", workflow: "sub.json" },
        { id: "http_request_node", type: "http_request", url: "https://api.example.com/test", method: "POST" },
        { id: "end_node", type: "end" },
      ],
      edges: [
        { id: "e1", source: "start_node", target: "switch_node" },
        { id: "e2", source: "switch_node", target: "wait_node", branch: "ok" },
        { id: "e3", source: "wait_node", target: "merge_node" },
        { id: "e4", source: "merge_node", target: "error_fallback_node" },
        { id: "e5", source: "error_fallback_node", target: "schedule_trigger_node" },
        { id: "e6", source: "schedule_trigger_node", target: "webhook_trigger_node" },
        { id: "e7", source: "webhook_trigger_node", target: "intent_classifier_node" },
        { id: "e8", source: "intent_classifier_node", target: "parameter_extractor_node" },
        { id: "e9", source: "parameter_extractor_node", target: "sub_workflow_node" },
        { id: "e10", source: "sub_workflow_node", target: "http_request_node" },
        { id: "e11", source: "http_request_node", target: "end_node" },
      ],
    };

    const res = validateWorkflow(dsl);
    expect(res.ok).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it("P1 节点缺专有必填字段 → SCHEMA 错误且 path 精确定位", () => {
    const dsl = {
      version: "dsh.workflow.v1",
      name: "missing_p1_fields_flow",
      nodes: [
        { id: "sw", type: "switch" },                          // missing cases
        { id: "sched", type: "schedule_trigger" },             // missing cron
        { id: "intent", type: "intent_classifier" },           // missing prompt
        { id: "param", type: "parameter_extractor" },          // missing schema & prompt
        { id: "http", type: "http_request" },                  // missing url
      ],
      edges: [],
    };

    const res = validateWorkflow(dsl);
    expect(res.ok).toBe(false);
    const schemaErrors = res.errors.filter((e) => e.code === "SCHEMA");
    const pick = (i: number) => schemaErrors.filter((e) => e.path.startsWith(`nodes[${i}]`)).map((e) => e.path);

    expect(pick(0)).toContain("nodes[0].cases");
    expect(pick(1)).toContain("nodes[1].cron");
    expect(pick(2)).toContain("nodes[2].prompt");
    expect(pick(3).some((p) => p.includes("schema") || p.includes("prompt"))).toBe(true);
    expect(pick(4)).toContain("nodes[4].url");
  });
});
