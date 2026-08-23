import type { NodeExecutor, NodeOutput } from "../engine.js";
import type { ExecutionContext } from "../engine.js";
import type { JsonValue } from "../variable-context.js";
import type { ParameterExtractorNode } from "@dsh-workflow/schema";
import { hostNotBound } from "./errors.js";
import { validateJsonSchema } from "./llm.js";

/**
 * parameter_extractor：参数抽取节点。
 * 调用 host.llm.complete 提取结构化数据，依据 node.schema 严格校验，
 * 校验通过后将抽取的对象作为节点输出原样返回。
 */
export const parameterExtractorExecutor: NodeExecutor = {
  type: "parameter_extractor",
  async execute(
    node: ParameterExtractorNode,
    _inputs: Record<string, NodeOutput[string]>,
    ctx: ExecutionContext,
  ): Promise<NodeOutput> {
    const llm = ctx.host.llm;
    if (!llm) {
      throw hostNotBound("llm");
    }

    if (!node.schema || typeof node.schema !== "object") {
      throw new Error(`parameter_extractor "${ctx.nodeId}": schema 必须为有效的 JSON Schema 对象`);
    }

    const promptText = ctx.varCtx.interpolate(node.prompt ?? node.input ?? "");
    const systemPrompt =
      "You are a structured parameter extractor. Extract information from the user prompt according to the given JSON Schema. Respond ONLY with the valid JSON object matching the schema.";

    let responseText: string;
    try {
      const res = await llm.complete({
        model: node.model,
        prompt: promptText,
        systemPrompt,
        outputSchema: node.schema,
      });
      responseText = res.text;
    } catch (e: unknown) {
      if (e instanceof Error) throw e;
      throw new Error(`parameter_extractor "${ctx.nodeId}": ${String(e)}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(responseText);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `parameter_extractor "${ctx.nodeId}": 模型返回非 JSON 格式内容，解析失败: ${msg}`,
      );
    }

    validateJsonSchema(parsed, node.schema, "$", ctx.nodeId);

    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return { ...(parsed as Record<string, JsonValue>), result: parsed as JsonValue };
    }
    return { result: parsed as JsonValue };
  },
};