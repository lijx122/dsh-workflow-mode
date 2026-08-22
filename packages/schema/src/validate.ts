import { Value } from "@sinclair/typebox/value";
import type { TSchema } from "@sinclair/typebox";
import {
  WorkflowDSLSchema,
  NodeType,
  ALL_NODE_TYPES,
  NODE_ID_REGEX,
  StartNodeSchema,
  EndNodeSchema,
  IfElseNodeSchema,
  IterationNodeSchema,
  HumanNodeSchema,
  LLMNodeSchema,
  SubagentNodeSchema,
  CodeNodeSchema,
  TemplateNodeSchema,
  SetVariableNodeSchema,
  PluginToolNodeSchema,
  SwitchNodeSchema,
  WaitNodeSchema,
  MergeNodeSchema,
  ErrorFallbackNodeSchema,
  ScheduleTriggerNodeSchema,
  WebhookTriggerNodeSchema,
  IntentClassifierNodeSchema,
  ParameterExtractorNodeSchema,
  SubWorkflowNodeSchema,
  HttpRequestNodeSchema,
} from "./dsl.js";

/**
 * 校验错误结构
 */
export interface ValidateError {
  path: string;
  code:
    | "SCHEMA"
    | "DANGLING_EDGE"
    | "CYCLE"
    | "UNKNOWN_NODE_TYPE"
    | "DUPLICATE_NODE_ID"
    | "INVALID_NODE_ID";
  message: string;
}

/**
 * 校验结果结构
 */
export interface ValidateResult {
  ok: boolean;
  errors: ValidateError[];
}

const NodeSchemaByType: Record<NodeType, TSchema> = {
  start: StartNodeSchema,
  end: EndNodeSchema,
  if_else: IfElseNodeSchema,
  iteration: IterationNodeSchema,
  human: HumanNodeSchema,
  llm: LLMNodeSchema,
  subagent: SubagentNodeSchema,
  code: CodeNodeSchema,
  template: TemplateNodeSchema,
  set_variable: SetVariableNodeSchema,
  plugin_tool: PluginToolNodeSchema,
  switch: SwitchNodeSchema,
  wait: WaitNodeSchema,
  merge: MergeNodeSchema,
  error_fallback: ErrorFallbackNodeSchema,
  schedule_trigger: ScheduleTriggerNodeSchema,
  webhook_trigger: WebhookTriggerNodeSchema,
  intent_classifier: IntentClassifierNodeSchema,
  parameter_extractor: ParameterExtractorNodeSchema,
  sub_workflow: SubWorkflowNodeSchema,
  http_request: HttpRequestNodeSchema,
};

/**
 * JSON Pointer 段反转义: "~0" -> "~", "~1" -> "/" (R4)
 */
function unescapePointerSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

/**
 * 将 TypeBox 返回的 JSON Pointer 路径转为 JSON Path 风格
 * 例: "/nodes/0/inputs" -> "nodes[0].inputs", "/name" -> "name"
 */
function pointerToJsonPath(pointer: string, prefix = ""): string {
  if (!pointer || pointer === "/") return prefix || "";
  const parts = pointer.split("/").filter(Boolean);
  let res = prefix;
  for (const rawPart of parts) {
    const part = unescapePointerSegment(rawPart);
    if (/^\d+$/.test(part)) {
      res = res ? `${res}[${part}]` : `[${part}]`;
    } else {
      res = res ? `${res}.${part}` : part;
    }
  }
  return res;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** 环路检测邻接表条目 */
interface AdjEntry {
  target: string;
  edgeIndex: number;
}

/** 顶层结构字段 —— 复用 WorkflowDSLSchema 单一真相源 (R3) */
const TOP_LEVEL_POINTERS = new Set(["/version", "/name", "/nodes", "/edges"]);

/**
 * 校验 WorkflowDSL 实例
 * 检查项包含：
 * 1. Schema 结构（顶层复用 WorkflowDSLSchema 单一真相源）
 * 2. 节点类型合法性 (UNKNOWN_NODE_TYPE)
 * 3. 节点 ID 格式与唯一性 (INVALID_NODE_ID, DUPLICATE_NODE_ID)
 * 4. 悬空连线 (DANGLING_EDGE)
 * 5. 环路 (CYCLE) — DFS 三色 + 完整回滚，全部后向边均报告
 */
export function validateWorkflow(raw: unknown): ValidateResult {
  const errors: ValidateError[] = [];

  if (!isRecord(raw)) {
    return {
      ok: false,
      errors: [
        {
          path: "",
          code: "SCHEMA",
          message: "Workflow must be an object",
        },
      ],
    };
  }

  const obj = raw;

  // 1. 顶层结构检查: 复用 WorkflowDSLSchema, 消除手写重复 (R3)
  for (const err of Value.Errors(WorkflowDSLSchema, raw)) {
    if (TOP_LEVEL_POINTERS.has(err.path)) {
      errors.push({
        path: pointerToJsonPath(err.path),
        code: "SCHEMA",
        message: err.message,
      });
    }
  }

  const rawNodes: unknown[] = Array.isArray(obj.nodes) ? obj.nodes : [];
  const rawEdges: unknown[] = Array.isArray(obj.edges) ? obj.edges : [];

  const seenNodeIds = new Set<string>();
  const validNodeIds = new Set<string>();

  // 2. 节点列表校验
  rawNodes.forEach((node, index) => {
    const nodePath = `nodes[${index}]`;

    if (!isRecord(node)) {
      errors.push({
        path: nodePath,
        code: "SCHEMA",
        message: `Node at index ${index} must be an object`,
      });
      return;
    }

    const nodeObj = node;

    // 校验 node.id
    if (typeof nodeObj.id !== "string") {
      errors.push({
        path: `${nodePath}.id`,
        code: "INVALID_NODE_ID",
        message: `Node at index ${index} is missing a valid string id`,
      });
    } else {
      if (!NODE_ID_REGEX.test(nodeObj.id)) {
        errors.push({
          path: `${nodePath}.id`,
          code: "INVALID_NODE_ID",
          message: `Invalid node id "${nodeObj.id}". Node id must match ${NODE_ID_REGEX.source}`,
        });
      }

      if (seenNodeIds.has(nodeObj.id)) {
        errors.push({
          path: `${nodePath}.id`,
          code: "DUPLICATE_NODE_ID",
          message: `Duplicate node id "${nodeObj.id}". Node ids must be unique across the workflow`,
        });
      } else {
        seenNodeIds.add(nodeObj.id);
        validNodeIds.add(nodeObj.id);
      }
    }

    // 校验 node.type
    if (typeof nodeObj.type !== "string") {
      errors.push({
        path: `${nodePath}.type`,
        code: "SCHEMA",
        message: `Node "${nodeObj.id ?? index}" is missing a string type`,
      });
    } else if (!ALL_NODE_TYPES.includes(nodeObj.type as NodeType)) {
      errors.push({
        path: `${nodePath}.type`,
        code: "UNKNOWN_NODE_TYPE",
        message: `Unknown node type "${nodeObj.type}". Must be one of: ${ALL_NODE_TYPES.join(", ")}`,
      });
    } else {
      // 已知类型节点专有 Schema 校验
      const schema = NodeSchemaByType[nodeObj.type as NodeType];
      if (schema) {
        for (const err of Value.Errors(schema, nodeObj)) {
          // id 缺失/非法已由 INVALID_NODE_ID 语义检查单独报告, 避免重复 (R6)
          if (err.path === "/id") {
            const idOk = typeof nodeObj.id === "string" && NODE_ID_REGEX.test(nodeObj.id);
            if (!idOk) continue;
          }
          const fieldPath = pointerToJsonPath(err.path, nodePath);
          errors.push({
            path: fieldPath,
            code: "SCHEMA",
            message: err.message,
          });
        }
      }
    }
  });

  // 3. 连线列表校验
  rawEdges.forEach((edge, index) => {
    const edgePath = `edges[${index}]`;

    if (!isRecord(edge)) {
      errors.push({
        path: edgePath,
        code: "SCHEMA",
        message: `Edge at index ${index} must be an object`,
      });
      return;
    }

    const edgeObj = edge;

    if (typeof edgeObj.id !== "string" || edgeObj.id.trim() === "") {
      errors.push({
        path: `${edgePath}.id`,
        code: "SCHEMA",
        message: `Edge at index ${index} must have a string id`,
      });
    }

    let hasSourceError = false;
    if (typeof edgeObj.source !== "string" || edgeObj.source.trim() === "") {
      errors.push({
        path: `${edgePath}.source`,
        code: "SCHEMA",
        message: `Edge at index ${index} must have a valid string source`,
      });
      hasSourceError = true;
    } else if (!validNodeIds.has(edgeObj.source)) {
      errors.push({
        path: `${edgePath}.source`,
        code: "DANGLING_EDGE",
        message: `Dangling edge: source node "${edgeObj.source}" does not exist`,
      });
      hasSourceError = true;
    }

    let hasTargetError = false;
    if (typeof edgeObj.target !== "string" || edgeObj.target.trim() === "") {
      errors.push({
        path: `${edgePath}.target`,
        code: "SCHEMA",
        message: `Edge at index ${index} must have a valid string target`,
      });
      hasTargetError = true;
    } else if (!validNodeIds.has(edgeObj.target)) {
      errors.push({
        path: `${edgePath}.target`,
        code: "DANGLING_EDGE",
        message: `Dangling edge: target node "${edgeObj.target}" does not exist`,
      });
      hasTargetError = true;
    }
  });

  // 4. 环路检测 (DFS 三色 + 完整回滚, 全部后向边均报告, S1)
  const adj = new Map<string, AdjEntry[]>();
  for (const id of validNodeIds) {
    adj.set(id, []);
  }
  for (const [edgeIndex, edge] of rawEdges.entries()) {
    if (!isRecord(edge)) continue;
    const { source, target } = edge;
    if (typeof source === "string" && typeof target === "string" && validNodeIds.has(source) && validNodeIds.has(target)) {
      adj.get(source)!.push({ target, edgeIndex });
    }
  }

  const visitState = new Map<string, number>(); // 0: unvisited, 1: on-stack, 2: done
  for (const id of validNodeIds) {
    visitState.set(id, 0);
  }

  const seenCycles = new Set<string>();

  const canonicalCycle = (nodes: string[]): string => {
    // 去掉收尾重复节点后旋转到最小 id 开头, 用于去重
    const arr = nodes.slice(0, -1);
    let minIdx = 0;
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] < arr[minIdx]) minIdx = i;
    }
    const rotated = [...arr.slice(minIdx), ...arr.slice(0, minIdx)];
    return rotated.join(" -> ");
  };

  const dfs = (u: string, path: string[]): void => {
    visitState.set(u, 1);
    path.push(u);

    for (const { target: v, edgeIndex } of adj.get(u) ?? []) {
      const state = visitState.get(v) ?? 0;
      if (state === 1) {
        // 后向边: 发现环。v 必在栈上, 但显式防御 indexOf === -1 的假环路径 (S1)
        const cycleStartIndex = path.indexOf(v);
        if (cycleStartIndex === -1) {
          continue;
        }
        const cyclePath = [...path.slice(cycleStartIndex), v];
        const key = canonicalCycle(cyclePath);
        if (seenCycles.has(key)) continue;
        seenCycles.add(key);
        errors.push({
          path: `edges[${edgeIndex}]`,
          code: "CYCLE",
          message: `Workflow contains a cycle: ${cyclePath.join(" -> ")}`,
        });
      } else if (state === 0) {
        dfs(v, path);
      }
    }

    path.pop();
    visitState.set(u, 2);
  };

  for (const id of validNodeIds) {
    if ((visitState.get(id) ?? 0) === 0) {
      dfs(id, []);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}
