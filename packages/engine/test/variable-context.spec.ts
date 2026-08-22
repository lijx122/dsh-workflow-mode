import { describe, it, expect } from "vitest";
import { VariableContext, WorkflowVarError } from "../src/index.js";

describe("VariableContext", () => {
  describe("ref — 直接引用（单占位符保型直传）", () => {
    it("① 合法单占位符返回原始 JsonValue 保型（对象/数组/标量原样返回）", () => {
      const ctx = new VariableContext();
      const dataObj = { a: 1, b: { c: 2 } };
      const arr = [1, "x", { y: 3 }];
      ctx.set("nodeA", {
        data: dataObj,
        list: arr,
        num: 42,
        str: "hello",
        flag: true,
        nil: null,
      });

      // 对象/数组同引用直传（保型 + 保引用）
      expect(ctx.ref("{{#nodeA.data}}")).toBe(dataObj);
      expect(ctx.ref("{{#nodeA.list}}")).toBe(arr);
      // 标量保型
      expect(ctx.ref("{{#nodeA.num}}")).toBe(42);
      expect(ctx.ref("{{#nodeA.str}}")).toBe("hello");
      expect(ctx.ref("{{#nodeA.flag}}")).toBe(true);
      expect(ctx.ref("{{#nodeA.nil}}")).toBeNull();
    });

    it("①b 单占位符嵌套路径取值", () => {
      const ctx = new VariableContext();
      ctx.set("nodeA", { data: { b: { c: 42 } } });
      expect(ctx.ref("{{#nodeA.data.b.c}}")).toBe(42);
    });

    it("链式解析：值本身为单占位符时继续解析，最终保型", () => {
      const ctx = new VariableContext();
      ctx.set("nodeA", { ptr: "{{#nodeB.x}}" });
      ctx.set("nodeB", { x: 7 });
      expect(ctx.ref("{{#nodeA.ptr}}")).toBe(7);
    });

    it("非占位符字符串按字面量直通返回", () => {
      const ctx = new VariableContext();
      ctx.set("nodeA", { x: 1 });
      expect(ctx.ref("literal text")).toBe("literal text");
      expect(ctx.ref("mix {{#nodeA.x}} end")).toBe("mix {{#nodeA.x}} end");
    });
  });

  describe("ref — 错误路径", () => {
    it("② 引用了不存在的 nodeId → WorkflowVarError 且 path 正确", () => {
      const ctx = new VariableContext();
      ctx.set("nodeA", { x: 1 });

      try {
        ctx.ref("{{#ghost.prop}}");
        throw new Error("应当抛出 WorkflowVarError");
      } catch (e) {
        expect(e).toBeInstanceOf(WorkflowVarError);
        const err = e as WorkflowVarError;
        expect(err.path).toBe("{{#ghost.prop}}");
        expect(err.message).toContain("ghost");
      }
    });

    it("节点已 set 但未输出目标属性 → WorkflowVarError 且 path 正确", () => {
      const ctx = new VariableContext();
      ctx.set("nodeA", { other: 1 });

      try {
        ctx.ref("{{#nodeA.missing}}");
        throw new Error("应当抛出 WorkflowVarError");
      } catch (e) {
        expect(e).toBeInstanceOf(WorkflowVarError);
        const err = e as WorkflowVarError;
        expect(err.path).toBe("{{#nodeA.missing}}");
        expect(err.message).toContain("nodeA");
      }
    });

    it("① 原型链穿透拦截：ref({{#n.__proto__}}) 应抛 WorkflowVarError", () => {
      const ctx = new VariableContext();
      ctx.set("n", { x: 1 });
      expect(() => ctx.ref("{{#n.__proto__}}")).toThrow(WorkflowVarError);
    });

    it("② 原型链穿透拦截：ref({{#n.toString}}) 应抛 WorkflowVarError", () => {
      const ctx = new VariableContext();
      ctx.set("n", { x: 1 });
      expect(() => ctx.ref("{{#n.toString}}")).toThrow(WorkflowVarError);
    });

    it("③ 循环引用检测：两节点互引抛出 WorkflowVarError", () => {
      const ctx = new VariableContext();
      ctx.set("nodeA", { b: "{{#nodeB.x}}" });
      ctx.set("nodeB", { x: "{{#nodeA.b}}" });

      try {
        ctx.ref("{{#nodeA.b}}");
        throw new Error("应当抛出 WorkflowVarError");
      } catch (e) {
        expect(e).toBeInstanceOf(WorkflowVarError);
        const err = e as WorkflowVarError;
        expect(err.path).toBe("{{#nodeA.b}}");
        expect(err.message).toContain("循环引用");
      }
    });

    it("③b 自引用环同样被检测", () => {
      const ctx = new VariableContext();
      ctx.set("nodeS", { v: "{{#nodeS.v}}" });

      expect(() => ctx.ref("{{#nodeS.v}}")).toThrow(WorkflowVarError);
    });
  });

  describe("interpolate — 混排文本插值", () => {
    it("④ 占位符混排常量：字符串直出，非字符串 JSON.stringify", () => {
      const ctx = new VariableContext();
      ctx.set("user", {
        name: "Alice",
        tags: ["a", "b"],
        count: 3,
        meta: { role: "admin" },
      });

      const out = ctx.interpolate(
        "Hello {{#user.name}}, tags={{#user.tags}}, count={{#user.count}}, meta={{#user.meta}}",
      );
      expect(out).toBe(
        'Hello Alice, tags=["a","b"], count=3, meta={"role":"admin"}',
      );
    });

    it("④b 纯常量文本原样返回；链式占位符也生效", () => {
      const ctx = new VariableContext();
      ctx.set("nodeA", { ptr: "{{#nodeB.x}}" });
      ctx.set("nodeB", { x: "ok" });
      expect(ctx.interpolate("plain text without placeholder")).toBe(
        "plain text without placeholder",
      );
      expect(ctx.interpolate("value: {{#nodeA.ptr}}!")).toBe("value: ok!");
    });

    it("③ 尾点占位符在 interpolate 中应抛 WorkflowVarError", () => {
      const ctx = new VariableContext();
      ctx.set("a", { x: 1 });
      expect(() => ctx.interpolate("test {{#a.x.}} end")).toThrow(WorkflowVarError);
    });
  });

  describe("evalExpr — 表达式求值", () => {
    it("⑤ audit.riskLevel == 'HIGH' 形态正确求值", () => {
      const ctx = new VariableContext();
      ctx.set("audit", {
        riskLevel: "HIGH",
        score: 0.97,
        passed: true,
      });

      expect(ctx.evalExpr("audit.riskLevel == 'HIGH'")).toBe(true);
      expect(ctx.evalExpr("audit.riskLevel != 'LOW'")).toBe(true);
      expect(ctx.evalExpr("audit.score > 0.9 and audit.passed")).toBe(true);
      expect(ctx.evalExpr("audit.riskLevel == 'HIGH' ? 1 : 0")).toBe(1);
    });

    it("⑥ 注入安全：变量值含单引号，经 vars 传值参与比较不出错", () => {
      const ctx = new VariableContext();
      // 值本身含单引号——若引擎文本拼接求值会破坏表达式语法
      ctx.set("auditA", { riskLevel: "it's HIGH" });
      ctx.set("auditB", { riskLevel: "it's HIGH" });

      // 含单引号字符串值经 vars 参与比较，应正确求值
      expect(ctx.evalExpr("auditA.riskLevel == auditB.riskLevel")).toBe(true);
      // 使用 var 间比较而非字符串字面量，避免 expr-eval 不支持转义引号的问题
      expect(ctx.evalExpr("auditA.riskLevel != 'LOW'")).toBe(true);
    });

    it("表达式求值错误包装为带原始表达式的 Error", () => {
      const ctx = new VariableContext();
      try {
        ctx.evalExpr("1 +");
        throw new Error("应当抛出包装 Error");
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
        expect((e as Error).message).toContain("1 +");
      }
    });
  });

  describe("运行隔离", () => {
    it("两个 VariableContext 实例互不可见（并发多运行隔离）", () => {
      const runA = new VariableContext();
      const runB = new VariableContext();
      runA.set("nodeX", { v: "from A" });
      runB.set("nodeX", { v: "from B" });

      expect(runA.ref("{{#nodeX.v}}")).toBe("from A");
      expect(runB.ref("{{#nodeX.v}}")).toBe("from B");

      const runC = new VariableContext();
      expect(() => runC.ref("{{#nodeX.v}}")).toThrow(WorkflowVarError);
    });
  });
});