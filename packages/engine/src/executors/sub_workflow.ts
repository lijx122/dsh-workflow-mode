import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { NodeExecutor, NodeOutput } from "../engine.js";
import type { ExecutionContext } from "../engine.js";
import type { SubWorkflowNode, WorkflowDSL } from "@dsh-workflow/schema";
import { WorkflowEngine } from "../engine.js";
import { createExecutors } from "./index.js";

/**
 * sub_workflow：子工作流调用节点。
 * 支持通过文件引用（node.workflow / node.workflowName / node.workflowPath）或内联 DSL（node.inlineDsl）递归调用工作流。
 * 在执行前压栈校验深度（≤3 或 node.maxDepth）并检测递归环路。
 */
export const subWorkflowExecutor: NodeExecutor = {
  type: "sub_workflow",
  async execute(
    node: SubWorkflowNode,
    inputs: Record<string, NodeOutput[string]>,
    ctx: ExecutionContext,
  ): Promise<NodeOutput> {
    // 1. 获取子工作流 DSL
    let childDsl: WorkflowDSL | null = null;
    let workflowIdentifier = "inline";

    if (node.inlineDsl && typeof node.inlineDsl === "object") {
      childDsl = node.inlineDsl as WorkflowDSL;
      workflowIdentifier = childDsl.name ?? "inline";
    } else if (node.workflow && typeof node.workflow === "object") {
      childDsl = node.workflow as unknown as WorkflowDSL;
      workflowIdentifier = childDsl.name ?? "inline";
    } else {
      const workflowRef =
        (typeof node.workflow === "string" ? node.workflow : undefined) ??
        node.workflowName ??
        node.workflowPath;

      if (!workflowRef) {
        throw new Error(`sub_workflow "${ctx.nodeId}": 缺少 workflow 引用或内联 DSL`);
      }
      workflowIdentifier = workflowRef;

      // 优先经 host.resolveWorkflow 解析
      if (ctx.host.resolveWorkflow) {
        childDsl = await ctx.host.resolveWorkflow(workflowRef);
      } else {
        // 本地文件读取兜底
        childDsl = loadLocalWorkflow(workflowRef);
      }

      if (!childDsl) {
        throw new Error(`sub_workflow "${ctx.nodeId}": 无法解析工作流 "${workflowRef}"`);
      }
    }

    // 2. 调用栈深度与环路校验
    const currentStack = ctx.callStack ?? [];
    const maxDepth = node.maxDepth ?? 3;

    if (currentStack.length >= maxDepth) {
      throw new Error(
        `sub_workflow "${ctx.nodeId}": 调用深度超过上限 ${maxDepth}，当前调用栈: [${[
          ...currentStack,
          workflowIdentifier,
        ].join(" -> ")}]`,
      );
    }

    if (currentStack.includes(workflowIdentifier)) {
      throw new Error(
        `sub_workflow "${ctx.nodeId}": 检测到递归环路: [${[
          ...currentStack,
          workflowIdentifier,
        ].join(" -> ")}]`,
      );
    }

    // 3. 执行子工作流
    const childExecutors = createExecutors();
    const childEngine = new WorkflowEngine(childExecutors, {
      host: ctx.host,
    });

    const childInputs = { ...inputs };
    const nextStack = [...currentStack, workflowIdentifier];

    const result = await childEngine.run(childDsl, childInputs, {
      callStack: nextStack,
      host: ctx.host,
    });

    if (result.status === "failed") {
      throw new Error(`sub_workflow "${ctx.nodeId}": 子工作流 "${workflowIdentifier}" 执行失败`);
    }

    // 4. 汇总子工作流输出
    const endNode = childDsl.nodes.find((n) => n.type === "end");
    const endOutputs = endNode ? result.outputs[endNode.id] ?? {} : {};

    return {
      ...endOutputs,
      ...result.outputs,
    };
  },
};

function loadLocalWorkflow(ref: string): WorkflowDSL | null {
  const candidates = [
    ref,
    resolve(".dsh/workflows", ref.endsWith(".json") ? ref : `${ref}.json`),
    resolve(".dsh/workflows", ref),
    ref.endsWith(".json") ? ref : `${ref}.json`,
  ];

  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        const content = readFileSync(p, "utf-8");
        return JSON.parse(content) as WorkflowDSL;
      } catch {
        // continue checking
      }
    }
  }
  return null;
}