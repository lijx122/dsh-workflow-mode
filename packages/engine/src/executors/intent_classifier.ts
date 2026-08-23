import type { NodeExecutor, NodeOutput } from "../engine.js";
import type { ExecutionContext } from "../engine.js";
import type { IntentClassifierNode } from "@dsh-workflow/schema";
import { hostNotBound } from "./errors.js";

/**
 * intent_classifier：意图分类节点。
 * 调用 host.llm.complete 对输入文本进行意图分类，输出必须严格属于 categories 枚举之一。
 * 若模型输出不在枚举中，自动重试一次纠偏；若仍不合法则抛出明确错误。
 */
export const intentClassifierExecutor: NodeExecutor = {
  type: "intent_classifier",
  async execute(
    node: IntentClassifierNode,
    _inputs: Record<string, NodeOutput[string]>,
    ctx: ExecutionContext,
  ): Promise<NodeOutput> {
    const llm = ctx.host.llm;
    if (!llm) {
      throw hostNotBound("llm");
    }

    const categories = node.categories ?? node.intents ?? [];
    if (!Array.isArray(categories) || categories.length === 0) {
      throw new Error(`intent_classifier "${ctx.nodeId}": categories 列表不能为空`);
    }

    const promptText = ctx.varCtx.interpolate(node.prompt ?? node.input ?? "");
    const systemPrompt =
      `You are an intent classifier. Categorize the user input into exactly one of the following categories: [${categories.join(
)}]. Respond ONLY with the chosen category name, with no extra punctuation or explanations.`;

    // 首次尝试
    let response = await llm.complete({
      model: node.model,
      prompt: promptText,
      systemPrompt,
    });

    let matched = matchCategory(response.text, categories);

    // 若不合法，重试一次
    if (!matched) {
      const retryPrompt = `${promptText}\n\n[Notice: Your previous response "${response.text.trim()}" was invalid. You MUST select exactly one from [${categories.join(", ")}]. Output only the category name.]`;

      response = await llm.complete({
        model: node.model,
        prompt: retryPrompt,
        systemPrompt,
      });

      matched = matchCategory(response.text, categories);
    }

    if (!matched) {
      throw new Error(
        `intent_classifier "${ctx.nodeId}": 模型输出 "${response.text.trim()}" 不在合法类别列表 [${categories.join(", ")}] 中`,
      );
    }

    return { category: matched };
  },
};

function matchCategory(text: string, categories: string[]): string | undefined {
  const trimmed = text.trim();
  // 1. 精确匹配
  const exact = categories.find((c) => c === trimmed);
  if (exact) return exact;

  // 2. 忽略大小写匹配
  const lower = trimmed.toLowerCase();
  const caseMatch = categories.find((c) => c.toLowerCase() === lower);
  if (caseMatch) return caseMatch;

  // 3. 包含词匹配
  for (const c of categories) {
    if (lower === c.toLowerCase() || lower.includes(c.toLowerCase())) {
      return c;
    }
  }

  return undefined;
}