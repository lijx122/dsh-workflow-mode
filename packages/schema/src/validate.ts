import { Value } from "@sinclair/typebox/value";
import {
  WorkflowDSL,
  WorkflowDSLSchema,
  WorkflowNode,
  WorkflowEdge,
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

const NodeSchemaByType: Record<NodeType, any> = {
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
 * 将 TypeBox 返回的 JSON Pointer 路径转为 JSON Path 风格
 * 例: "/nodes/0/inputs" -> "nodes[0].inputs", "/name" -> "name"
 */
function pointerToJsonPath(pointer: string, prefix = ""): string {
  if (!pointer || pointer === "/") return prefix || "";
  const parts = pointer.split("/").filter(Boolean);
  let res = prefix;
  for (const part of parts) {
    if (/^\d+$/.test(part)) {
      res = res ? `${res}[${part}]` : `[${part}]`;
    } else {
      res = res ? `${res}.${part}` : part;
    }
  }
  return res;
}

/**
 * 校验 WorkflowDSL 实例
 * 检查项包含：
 * 1. Schema 结构
 * 2. 节点类型合法性 (UNKNOWN_NODE_TYPE)
 * 3. 节点 ID 格式与唯一性 (INVALID_NODE_ID, DUPLICATE_NODE_ID)
 * 4. 悬空连线 (DANGLING_EDGE)
 * 5. 环路 (CYCLE)
 */
export function validateWorkflow(raw: unknown): ValidateResult {
  const errors: ValidateError[] = [];

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
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

  const obj = raw as Record<string, unknown>;

  // 1. 顶层基础字段检查
  if (obj.version !== "dsh.workflow.v1") {
    errors.push({
      path: "version",
      code: "SCHEMA",
      message: 'Workflow version must be "dsh.workflow.v1"',
    });
  }

  if (typeof obj.name !== "string" || obj.name.trim() === "") {
    errors.push({
      path: "name",
      code: "SCHEMA",
      message: "Workflow name is required and must be a non-empty string",
    });
  }

  if (!Array.isArray(obj.nodes)) {
    errors.push({
      path: "nodes",
      code: "SCHEMA",
      message: "Workflow nodes is required and must be an array",
    });
  }

  if (!Array.isArray(obj.edges)) {
    errors.push({
      path: "edges",
      code: "SCHEMA",
      message: "Workflow edges is required and must be an array",
    });
  }

  const rawNodes = Array.isArray(obj.nodes) ? obj.nodes : [];
  const rawEdges = Array.isArray(obj.edges) ? obj.edges : [];

  const seenNodeIds = new Set<string>();
  const validNodeIds = new Set<string>();

  // 2. 节点列表校验
  rawNodes.forEach((node, index) => {
    const nodePath = `nodes[${index}]`;

    if (!node || typeof node !== "object" || Array.isArray(node)) {
      errors.push({
        path: nodePath,
        code: "SCHEMA",
        message: `Node at index ${index} must be an object`,
      });
      return;
    }

    const nodeObj = node as Record<string, unknown>;

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
          // 忽略已单独处理过的 id 格式错误
          if (err.path === "/id" && typeof nodeObj.id === "string" && !NODE_ID_REGEX.test(nodeObj.id)) {
            continue;
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

    if (!edge || typeof edge !== "object" || Array.isArray(edge)) {
      errors.push({
        path: edgePath,
        code: "SCHEMA",
        message: `Edge at index ${index} must be an object`,
      });
      return;
    }

    const edgeObj = edge as Record<string, unknown>;

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

  // 4. 环路检测 (DFS)
  // 仅在各边 source 与 target 均有效时进行拓扑成环分析
  const adj = new Map<string, string[]>();
  for (const id of validNodeIds) {
    adj.set(id, []);
  }

  for (const edge of rawEdges) {
    if (
      edge &&
      typeof edge === "object" &&
      typeof (edge as any).source === "string" &&
      typeof (edge as any).target === "string"
    ) {
      const src = (edge as any).source;
      const tgt = (edge as any).target;
      if (validNodeIds.has(src) && validNodeIds.has(tgt)) {
        adj.get(src)!.push(tgt);
      }
    }
  }

  const visitState = new Map<string, number>(); // 0: unvisited, 1: visiting, 2: visited
  for (const id of validNodeIds) {
    visitState.set(id, 0);
  }

  const dfs = (u: string, path: string[]): boolean => {
    visitState.set(u, 1);
    path.push(u);

    for (const v of adj.get(u) || []) {
      if (visitState.get(v) === 1) {
        const cycleStartIndex = path.indexOf(v);
        const cyclePath = [...path.slice(cycleStartIndex), v].join(" -> ");
        errors.push({
          path: "edges",
          code: "CYCLE",
          message: `Workflow contains a cycle: ${cyclePath}`,
        });
        return true;
      }
      if (visitState.get(v) === 0) {
        if (dfs(v, path)) {
          return true;
        }
      }
    }

    path.pop();
    visitState.set(u, 2);
    return false;
  };

  for (const id of validNodeIds) {
    if (visitState.get(id) === 0) {
      dfs(id, []);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}
