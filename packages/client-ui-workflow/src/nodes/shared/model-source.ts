/**
 * §10.1 模型接口降级探测（M2）。
 *
 * 客户端 contract 无任何模型读写 API（P0-1 实证）。本模块探测
 * dsh-client-ui-model-selection 数据源的多种可能挂载形态：
 * 探得 → 可编辑下拉；探不得 → 降级为只读展示会话当前模型。
 * 两种结局都算验收通过；降级结局登记 TECH_DEBT。
 *
 * 全程 try/catch + 形状白名单解析，绝不 throw。
 */
import type { ModelCatalogSnapshot, ModelOption } from "../../types.js";

const PROBE_KEYS = [
  "__DSH_MODEL_SELECTION__",
  "dsh_client_ui_model_selection",
  "dsh-client-ui-model-selection",
] as const;

/** 默认回退内置模型列表（当宿主环境未暴露任何模型注册表时兜底）。 */
export const DEFAULT_FALLBACK_MODELS: ModelOption[] = [
  { id: "deepseek-chat", label: "DeepSeek V3 (deepseek-chat)" },
  { id: "deepseek-reasoner", label: "DeepSeek R1 (deepseek-reasoner)" },
  { id: "gemini-3.7-flash-high", label: "Gemini 3.7 Flash High (DSH Default)" },
  { id: "claude-3-7-sonnet-20250219", label: "Claude 3.7 Sonnet" },
  { id: "gpt-4o", label: "GPT-4o" },
  { id: "qwen-plus", label: "Qwen Plus (通义千问)" },
];

/** 从候选原始值解析模型目录；只接受可辨识形状。 */
export function parseModelCatalog(raw: unknown): ModelCatalogSnapshot {
  try {
    let candidate: unknown = raw;
    // 函数型数据源：调用一次取快照。
    if (typeof candidate === "function") {
      candidate = (candidate as () => unknown)();
    }
    // store 型数据源：getSnapshot()。
    if (
      candidate !== null &&
      typeof candidate === "object" &&
      typeof (candidate as { getSnapshot?: unknown }).getSnapshot === "function"
    ) {
      candidate = (candidate as { getSnapshot: () => unknown }).getSnapshot();
    }
    // 包装对象 { models | list }。
    if (candidate !== null && typeof candidate === "object") {
      const wrapper = candidate as { models?: unknown; list?: unknown };
      if (!Array.isArray(candidate)) {
        if (Array.isArray(wrapper.models)) candidate = wrapper.models;
        else if (Array.isArray(wrapper.list)) candidate = wrapper.list;
      }
    }
    if (!Array.isArray(candidate)) {
      return { available: false, models: [], source: "unavailable" };
    }
    const models: ModelOption[] = [];
    for (const entry of candidate) {
      if (entry === null || typeof entry !== "object") continue;
      const rec = entry as Record<string, unknown>;
      const id = typeof rec.id === "string" ? rec.id : undefined;
      if (id === undefined) continue;
      const labelRaw = rec.label ?? rec.name ?? rec.title;
      const label = typeof labelRaw === "string" && labelRaw.length > 0 ? labelRaw : id;
      models.push({ id, label });
    }
    if (models.length === 0) {
      return { available: false, models: [], source: "unavailable" };
    }
    return { available: true, models, source: "dsh-client-ui-model-selection" };
  } catch {
    return { available: false, models: [], source: "unavailable" };
  }
}

/** 在宿主全局上探测模型选择数据源。 */
export function probeModelCatalog(host: unknown = globalThis): ModelCatalogSnapshot {
  if (host === null || typeof host !== "object") {
    return { available: false, models: [], source: "unavailable" };
  }
  const record = host as Record<string, unknown>;
  for (const key of PROBE_KEYS) {
    try {
      const found = parseModelCatalog(record[key]);
      if (found.available) return found;
    } catch {
      /* 单键失败不影响其余候选 */
    }
  }

  // 尝试从 window.__DSH_BOOT__ 探测
  try {
    const boot = record.__DSH_BOOT__ as { models?: unknown; settings?: { models?: unknown } } | undefined;
    if (boot) {
      const bootModels = parseModelCatalog(boot.models ?? boot.settings?.models);
      if (bootModels.available) return bootModels;
    }
  } catch { /* noop */ }

  return { available: false, models: [], source: "unavailable" };
}

/**
 * llm 卡片/面板的模型展示文案：
 * 显式选择了模型 → 模型 id；否则会话当前模型；再否则「跟随会话」占位。
 */
export function resolveModelDisplay(
  nodeModel: unknown,
  sessionModelId: string | undefined,
): string {
  if (typeof nodeModel === "string" && nodeModel.length > 0) return nodeModel;
  if (typeof sessionModelId === "string" && sessionModelId.length > 0) return sessionModelId;
  return "(跟随会话)";
}
