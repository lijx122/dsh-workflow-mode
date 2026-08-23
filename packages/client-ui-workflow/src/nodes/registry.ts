/**
 * NODE_REGISTRY（M2，§4.2）：12 类 DSL 节点统一定义表。
 * block-selector 三分组、画布节点类型映射、属性面板路由均以此为准。
 */
import type { NodeType } from "@dsh-workflow/schema";
import type { NodeDefinition, NodeGroup } from "../types.js";

import startDef from "./start/index.js";
import endDef from "./end/index.js";
import ifElseDef from "./if_else/index.js";
import switchDef from "./switch/index.js";
import mergeDef from "./merge/index.js";
import setVariableDef from "./set_variable/index.js";
import iterationDef from "./iteration/index.js";
import llmDef from "./llm/index.js";
import subagentDef from "./subagent/index.js";
import humanDef from "./human/index.js";
import templateDef from "./template/index.js";
import codeDef from "./code/index.js";

/** 注册顺序即 block-selector 展示顺序。 */
export const NODE_REGISTRY: ReadonlyMap<NodeType, NodeDefinition> = new Map<NodeType, NodeDefinition>([
  [startDef.type, startDef],
  [endDef.type, endDef],
  [ifElseDef.type, ifElseDef],
  [switchDef.type, switchDef],
  [mergeDef.type, mergeDef],
  [setVariableDef.type, setVariableDef],
  [iterationDef.type, iterationDef],
  [llmDef.type, llmDef],
  [subagentDef.type, subagentDef],
  [humanDef.type, humanDef],
  [templateDef.type, templateDef],
  [codeDef.type, codeDef],
]);

/** 按 type 查定义；未知类型（21 种 DSL 全集里的其余类型）返回 undefined。 */
export function getNodeDefinition(type: string): NodeDefinition | undefined {
  return NODE_REGISTRY.get(type as NodeType);
}

/** 全量定义列表（注册顺序）。 */
export function listNodeDefinitions(): NodeDefinition[] {
  return [...NODE_REGISTRY.values()];
}

/** 分组展示顺序与标题（block-selector 三分组）。 */
export const GROUP_ORDER: readonly NodeGroup[] = ["logic", "ai", "transform"];

/** 本期 Studio 化的 12 个类型全集（§10.20 逐类型验收清单基准）。 */
export const STUDIO_NODE_TYPES: readonly NodeType[] = listNodeDefinitions().map((d) => d.type);
