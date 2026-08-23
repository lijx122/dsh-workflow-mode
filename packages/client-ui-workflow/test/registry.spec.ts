import { describe, it, expect } from "vitest";
import { validateWorkflow } from "@dsh-workflow/schema";
import { NODE_REGISTRY, listNodeDefinitions, STUDIO_NODE_TYPES, getNodeDefinition } from "../src/nodes/registry.js";

/** §10.20 逐类型验收的 12 类基准。 */
const EXPECTED_TYPES = [
  "start", "end", "if_else", "switch", "merge", "set_variable",
  "iteration", "llm", "subagent", "human", "template", "code",
] as const;

describe("NODE_REGISTRY 完整性（§10.20）", () => {
  it("应恰好注册 12 类且与 DSL 类型基准一致", () => {
    expect(STUDIO_NODE_TYPES).toHaveLength(12);
    for (const t of EXPECTED_TYPES) {
      expect(NODE_REGISTRY.has(t), "缺少节点类型: " + t).toBe(true);
    }
  });

  it.each(EXPECTED_TYPES)("%s：五要素齐全且组件可调用", (type) => {
    const def = getNodeDefinition(type)!;
    expect(def.label.length).toBeGreaterThan(0);
    expect(def.icon.length).toBeGreaterThan(0);
    expect(def.colorToken.length).toBeGreaterThan(0);
    expect(typeof def.subtitle).toBe("function");
    expect(typeof def.CardComponent).toBe("function");
    expect(typeof def.PanelComponent).toBe("function");
  });

  it("defaultFactory 产出的最小 DSL 均通过 schema 校验", () => {
    for (const def of listNodeDefinitions()) {
      const node = def.defaultFactory("n_" + def.type);
      expect(node.id).toBe("n_" + def.type);
      expect(node.type).toBe(def.type);
      const result = validateWorkflow({
        version: "dsh.workflow.v1",
        name: "factory-smoke-" + def.type,
        nodes: [node],
        edges: [],
      });
      expect(result.errors, JSON.stringify(result.errors)).toEqual([]);
      expect(result.ok).toBe(true);
    }
  });

  it("checkValid 可调用：合法默认值通过、空必填字段报错", () => {
    for (const def of listNodeDefinitions()) {
      const node = def.defaultFactory("t_" + def.type);
      // 默认工厂允许尚未填写（返回错误信息或 null，但绝不可 throw）。
      expect(() => def.checkValid(node)).not.toThrow();
      expect(["string", "object"]).toContain(typeof def.checkValid(node) === "object" ? "object" : typeof def.checkValid(node));
    }
    // 必填提示词类：清空后必须给出非空错误信息。
    for (const t of ["llm", "subagent", "human", "template", "code"] as const) {
      const def = getNodeDefinition(t)!;
      const node = def.defaultFactory("empty_" + t) as Record<string, unknown>;
      const field = t === "template" ? "template" : t === "code" ? "code" : "prompt";
      node[field] = "";
      const verdict = def.checkValid(node as never);
      expect(typeof verdict).toBe("string");
      expect((verdict as string).length).toBeGreaterThan(0);
    }
  });

  it("llm 工厂支持 UI 扩展字段（temperature 存于 inputs），校验仍放行", () => {
    const llm = getNodeDefinition("llm")!.defaultFactory("llm_x") as Record<string, unknown>;
    const patched = { ...llm, prompt: "hi", inputs: { ...(llm.inputs as object), temperature: 0.5 } };
    const result = validateWorkflow({ version: "dsh.workflow.v1", name: "ext-llm", nodes: [patched], edges: [] });
    expect(result.ok).toBe(true);
  });

  it("subagent 支持 UI 扩展字段 workspace（inputs.workspace），校验仍放行", () => {
    const sa = getNodeDefinition("subagent")!.defaultFactory("sa_x") as Record<string, unknown>;
    const patched = { ...sa, prompt: "do", inputs: { workspace: "~/agents/vip-triage" } };
    const result = validateWorkflow({ version: "dsh.workflow.v1", name: "ext-subagent", nodes: [patched], edges: [] });
    expect(result.ok).toBe(true);
  });

  it("subtitle 对各类型默认节点返回字符串", () => {
    for (const def of listNodeDefinitions()) {
      const node = def.defaultFactory("s_" + def.type);
      expect(typeof def.subtitle!(node)).toBe("string");
    }
  });
});
