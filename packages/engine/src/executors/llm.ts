import type { NodeExecutor, NodeOutput } from "../engine.js";
import type { JsonValue } from "../variable-context.js";
import type { ExecutionContext } from "../engine.js";
import type { LLMNode } from "@dsh-workflow/schema";
import { hostNotBound } from "./errors.js";

/**
 * llm：大模型调用节点。
 *
 * 契约：
 * - 调 host.llm.complete({ model?, prompt: 插值后, systemPrompt?, outputSchema? })
 * - 返回 { text }：无 outputSchema 时 result = text（原始字符串）
 * - node.outputSchema 存在：result = JSON.parse(text)，并按 JSON Schema 子集校验，
 *   解析失败 / 不满足 schema → 抛错
 * - host.llm 缺失 → 抛 hostNotBound("llm")
 *
 * outputSchema 校验子集（契约注）：
 *   type(string|array of string, 含 "integer") / properties / required /
 *   items / enum / additionalProperties:false。不支持 $ref/oneOf/anyOf/allOf。
 */
export const llmExecutor: NodeExecutor = {
  type: "llm",
  async execute(
    node: LLMNode,
    _inputs: Record<string, NodeOutput[string]>,
    ctx: ExecutionContext,
  ): Promise<NodeOutput> {
    const llm = ctx.host.llm;
    if (!llm) {
      throw hostNotBound("llm");
    }

    const prompt = ctx.varCtx.interpolate(node.prompt);
    const systemPrompt = node.systemPrompt
      ? ctx.varCtx.interpolate(node.systemPrompt)
      : undefined;

    const { text } = await llm.complete({
      model: node.model,
      prompt,
      systemPrompt,
      outputSchema: node.outputSchema,
    });

    let result: JsonValue;
    if (node.outputSchema !== undefined && node.outputSchema !== null) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(
          `llm node "${ctx.nodeId}": outputSchema 存在但模型返回非 JSON 文本，解析失败: ${msg}`,
        );
      }
      validateJsonSchema(parsed, node.outputSchema, "$", ctx.nodeId);
      result = parsed as JsonValue;
    } else {
      result = text;
    }

    return { result };
  },
};

/** JSON Schema 子集校验器。不符合即抛错（消息含 schema 路径） */
function validateJsonSchema(
  value: unknown,
  schema: unknown,
  path: string,
  nodeId: string,
): void {
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    return;
  }
  const s = schema as Record<string, unknown>;

  // enum
  if (Array.isArray(s.enum)) {
    const has = (s.enum as unknown[]).some((item) => deepEq(item, value));
    if (!has) {
      throw schemaError(nodeId, path, `值 ${JSON.stringify(value)} 不在 enum ${JSON.stringify(s.enum)} 中`);
    }
  }

  // type
  if (s.type !== undefined) {
    const types = Array.isArray(s.type) ? (s.type as string[]) : [s.type as string];
    const actualType = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    const normalized =
      actualType === "number" && Number.isInteger(value as number)
        ? "integer"
        : actualType;
    if (!types.includes(normalized)) {
      throw schemaError(
        nodeId,
        path,
        `期望类型 ${types.join("|")}，实际 ${actualType}`,
      );
    }
  }

  // 嵌套
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(s.required)) {
      for (const key of s.required as string[]) {
        if (!(key in obj)) {
          throw schemaError(nodeId, path, `缺少必填属性 "${key}"`);
        }
      }
    }
    if (s.properties && typeof s.properties === "object" && !Array.isArray(s.properties)) {
      for (const [key, propSchema] of Object.entries(
        s.properties as Record<string, unknown>,
      )) {
        if (key in obj) {
          validateJsonSchema(obj[key], propSchema, `${path}.${key}`, nodeId);
        }
      }
    }
    if (
      s.additionalProperties === false &&
      s.properties &&
      typeof s.properties === "object"
    ) {
      const allowed = new Set(Object.keys(s.properties as Record<string, unknown>));
      for (const key of Object.keys(obj)) {
        if (!allowed.has(key)) {
          throw schemaError(nodeId, path, `多余属性 "${key}"（additionalProperties=false）`);
        }
      }
    }
  }

  if (Array.isArray(value) && s.items !== undefined) {
    for (let i = 0; i < value.length; i++) {
      validateJsonSchema(value[i], s.items, `${path}[${i}]`, nodeId);
    }
  }
}

function schemaError(nodeId: string, path: string, detail: string): Error {
  return new Error(`llm node "${nodeId}": outputSchema 校验失败于 ${path}: ${detail}`);
}

/** 深比较（JSON 语义） */
function deepEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((x, i) => deepEq(x, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as object).sort();
    const kb = Object.keys(b as object).sort();
    if (ka.length !== kb.length) return false;
    return ka.every(
      (k, i) =>
        k === kb[i] &&
        deepEq(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[kb[i]],
        ),
    );
  }
  return false;
}
