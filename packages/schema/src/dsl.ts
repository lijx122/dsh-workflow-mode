import { Type, Static } from "@sinclair/typebox";

/**
 * 节点 ID 正则表达式与模式字符串
 * 必须匹配 ^[a-zA-Z_][a-zA-Z0-9_]*$（保证表达式变量名安全）
 */
export const NODE_ID_PATTERN = "^[a-zA-Z_][a-zA-Z0-9_]*$";
export const NODE_ID_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * 节点类型全集枚举（21 种）
 * - P0（11 种含 start/end）
 * - P1（10 种）
 */
export const P0_NODE_TYPES = [
  "start",
  "end",
  "if_else",
  "iteration",
  "human",
  "llm",
  "subagent",
  "code",
  "template",
  "set_variable",
  "plugin_tool",
] as const;

export const P1_NODE_TYPES = [
  "switch",
  "wait",
  "merge",
  "error_fallback",
  "schedule_trigger",
  "webhook_trigger",
  "intent_classifier",
  "parameter_extractor",
  "sub_workflow",
  "http_request",
] as const;

export const ALL_NODE_TYPES = [...P0_NODE_TYPES, ...P1_NODE_TYPES] as const;

export const NodeTypeSchema = Type.Union([
  // P0 (11 种含 start/end)
  Type.Literal("start"),
  Type.Literal("end"),
  Type.Literal("if_else"),
  Type.Literal("iteration"),
  Type.Literal("human"),
  Type.Literal("llm"),
  Type.Literal("subagent"),
  Type.Literal("code"),
  Type.Literal("template"),
  Type.Literal("set_variable"),
  Type.Literal("plugin_tool"),
  // P1 (10 种)
  Type.Literal("switch"),
  Type.Literal("wait"),
  Type.Literal("merge"),
  Type.Literal("error_fallback"),
  Type.Literal("schedule_trigger"),
  Type.Literal("webhook_trigger"),
  Type.Literal("intent_classifier"),
  Type.Literal("parameter_extractor"),
  Type.Literal("sub_workflow"),
  Type.Literal("http_request"),
]);

export type NodeType = Static<typeof NodeTypeSchema>;

/**
 * 错误处理策略
 * - stop / continue 为 P0
 * - route 为 P1（且须连 error_fallback）
 */
export const OnErrorSchema = Type.Union([
  Type.Literal("stop"),
  Type.Literal("continue"),
  Type.Literal("route"),
]);

export type OnError = Static<typeof OnErrorSchema>;

/**
 * 重试配置
 */
export const RetryConfigSchema = Type.Union([
  Type.Number({ minimum: 0 }),
  Type.Object({
    max: Type.Optional(Type.Number({ minimum: 0 })),
    maxAttempts: Type.Optional(Type.Number({ minimum: 0 })),
    backoffMs: Type.Optional(Type.Number({ minimum: 0 })),
  }),
]);

export type RetryConfig = Static<typeof RetryConfigSchema>;

/**
 * 通用节点基础属性
 */
const BaseNodeFields = {
  id: Type.String({ pattern: NODE_ID_PATTERN }),
  name: Type.Optional(Type.String()),
  onError: Type.Optional(OnErrorSchema),
  retry: Type.Optional(RetryConfigSchema),
  timeoutMs: Type.Optional(Type.Number({ minimum: 0 })),
  inputs: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
};

// ================= P0 节点类型定义 =================

/** StartNode */
export const StartNodeInputParamSchema = Type.Object({
  type: Type.Union([
    Type.Literal("string"),
    Type.Literal("number"),
    Type.Literal("boolean"),
    Type.Literal("object"),
  ]),
  required: Type.Optional(Type.Boolean()),
  default: Type.Optional(Type.Unknown()),
});

export const StartNodeSchema = Type.Object({
  ...BaseNodeFields,
  type: Type.Literal("start"),
  inputs: Type.Optional(Type.Record(Type.String(), StartNodeInputParamSchema)),
});

export type StartNode = Static<typeof StartNodeSchema>;

/** EndNode */
export const EndNodeSchema = Type.Object({
  ...BaseNodeFields,
  type: Type.Literal("end"),
  outputs: Type.Optional(Type.Record(Type.String(), Type.String())),
});

export type EndNode = Static<typeof EndNodeSchema>;

/** IfElseNode */
export const IfElseNodeSchema = Type.Object({
  ...BaseNodeFields,
  type: Type.Literal("if_else"),
  condition: Type.String(),
});

export type IfElseNode = Static<typeof IfElseNodeSchema>;

/** IterationNode */
export const IterationNodeSchema = Type.Object({
  ...BaseNodeFields,
  type: Type.Literal("iteration"),
  over: Type.String(),
  maxIterations: Type.Optional(Type.Number({ minimum: 1, maximum: 500 })),
  maxConcurrency: Type.Optional(Type.Number({ minimum: 1 })),
  // body 嵌套子图（nodes/edges 结构）仅作宽松校验，递归校验延后至 T5/T10，已登记技术债 D4
  body: Type.Optional(
    Type.Union([
      Type.Array(Type.Any()),
      Type.Object({
        nodes: Type.Array(Type.Any()),
        edges: Type.Optional(Type.Array(Type.Any())),
      }),
    ])
  ),
});

export type IterationNode = Static<typeof IterationNodeSchema>;

/** HumanNode */
export const HumanNodeSchema = Type.Object({
  ...BaseNodeFields,
  type: Type.Literal("human"),
  prompt: Type.String(),
  timeoutMs: Type.Optional(Type.Number({ minimum: 0 })),
  onTimeout: Type.Optional(
    Type.Union([Type.Literal("abort"), Type.Literal("proceed")])
  ),
});

export type HumanNode = Static<typeof HumanNodeSchema>;

/** LLMNode */
export const LLMNodeSchema = Type.Object({
  ...BaseNodeFields,
  type: Type.Literal("llm"),
  prompt: Type.String(),
  model: Type.Optional(Type.String()),
  systemPrompt: Type.Optional(Type.String()),
  outputSchema: Type.Optional(Type.Unknown()),
});

export type LLMNode = Static<typeof LLMNodeSchema>;

/** SubagentNode */
export const SubagentNodeSchema = Type.Object({
  ...BaseNodeFields,
  type: Type.Literal("subagent"),
  prompt: Type.String(),
  preset: Type.Optional(Type.String()),
  backgroundMode: Type.Optional(Type.Literal("one-shot")),
});

export type SubagentNode = Static<typeof SubagentNodeSchema>;

/** CodeNode */
export const CodeNodeSchema = Type.Object({
  ...BaseNodeFields,
  type: Type.Literal("code"),
  code: Type.String(),
  inputs: Type.Optional(Type.Record(Type.String(), Type.String())),
});

export type CodeNode = Static<typeof CodeNodeSchema>;

/** TemplateNode */
export const TemplateNodeSchema = Type.Object({
  ...BaseNodeFields,
  type: Type.Literal("template"),
  template: Type.String(),
  inputs: Type.Optional(Type.Record(Type.String(), Type.String())),
});

export type TemplateNode = Static<typeof TemplateNodeSchema>;

/** SetVariableNode */
export const SetVariableAssignmentSchema = Type.Object({
  key: Type.String(),
  value: Type.String(),
});

export const SetVariableNodeSchema = Type.Object({
  ...BaseNodeFields,
  type: Type.Literal("set_variable"),
  assignments: Type.Array(SetVariableAssignmentSchema),
});

export type SetVariableNode = Static<typeof SetVariableNodeSchema>;

/** PluginToolNode */
export const PluginToolNodeSchema = Type.Object({
  ...BaseNodeFields,
  type: Type.Literal("plugin_tool"),
  toolName: Type.String(),
  action: Type.Optional(Type.String()),
  inputs: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export type PluginToolNode = Static<typeof PluginToolNodeSchema>;

// ================= P1 节点类型定义（专有字段待 T10 补齐） =================

/** SwitchNode (P1 字段待 T10 补齐) */
export const SwitchNodeSchema = Type.Object({
  ...BaseNodeFields,
  type: Type.Literal("switch"),
  cases: Type.Optional(Type.Array(Type.Object({ condition: Type.String(), target: Type.Optional(Type.String()) }))),
  defaultCase: Type.Optional(Type.String()),
});
export type SwitchNode = Static<typeof SwitchNodeSchema>;

/** WaitNode (P1 字段待 T10 补齐) */
export const WaitNodeSchema = Type.Object({
  ...BaseNodeFields,
  type: Type.Literal("wait"),
  durationMs: Type.Optional(Type.Number()),
});
export type WaitNode = Static<typeof WaitNodeSchema>;

/** MergeNode (P1 字段待 T10 补齐) */
export const MergeNodeSchema = Type.Object({
  ...BaseNodeFields,
  type: Type.Literal("merge"),
  strategy: Type.Optional(Type.String()),
});
export type MergeNode = Static<typeof MergeNodeSchema>;

/** ErrorFallbackNode (P1 字段待 T10 补齐) */
export const ErrorFallbackNodeSchema = Type.Object({
  ...BaseNodeFields,
  type: Type.Literal("error_fallback"),
});
export type ErrorFallbackNode = Static<typeof ErrorFallbackNodeSchema>;

/** ScheduleTriggerNode (P1 字段待 T10 补齐) */
export const ScheduleTriggerNodeSchema = Type.Object({
  ...BaseNodeFields,
  type: Type.Literal("schedule_trigger"),
  cron: Type.Optional(Type.String()),
});
export type ScheduleTriggerNode = Static<typeof ScheduleTriggerNodeSchema>;

/** WebhookTriggerNode (P1 字段待 T10 补齐) */
export const WebhookTriggerNodeSchema = Type.Object({
  ...BaseNodeFields,
  type: Type.Literal("webhook_trigger"),
  path: Type.Optional(Type.String()),
  secret: Type.Optional(Type.String()),
});
export type WebhookTriggerNode = Static<typeof WebhookTriggerNodeSchema>;

/** IntentClassifierNode (P1 字段待 T10 补齐) */
export const IntentClassifierNodeSchema = Type.Object({
  ...BaseNodeFields,
  type: Type.Literal("intent_classifier"),
  input: Type.Optional(Type.String()),
  intents: Type.Optional(Type.Array(Type.String())),
});
export type IntentClassifierNode = Static<typeof IntentClassifierNodeSchema>;

/** ParameterExtractorNode (P1 字段待 T10 补齐) */
export const ParameterExtractorNodeSchema = Type.Object({
  ...BaseNodeFields,
  type: Type.Literal("parameter_extractor"),
  schema: Type.Optional(Type.Unknown()),
});
export type ParameterExtractorNode = Static<typeof ParameterExtractorNodeSchema>;

/** SubWorkflowNode (P1 字段待 T10 补齐) */
export const SubWorkflowNodeSchema = Type.Object({
  ...BaseNodeFields,
  type: Type.Literal("sub_workflow"),
  workflowName: Type.Optional(Type.String()),
  workflowPath: Type.Optional(Type.String()),
});
export type SubWorkflowNode = Static<typeof SubWorkflowNodeSchema>;

/** HttpRequestNode (P1 字段待 T10 补齐) */
export const HttpRequestNodeSchema = Type.Object({
  ...BaseNodeFields,
  type: Type.Literal("http_request"),
  url: Type.Optional(Type.String()),
  method: Type.Optional(Type.String()),
  headers: Type.Optional(Type.Record(Type.String(), Type.String())),
  body: Type.Optional(Type.Unknown()),
});
export type HttpRequestNode = Static<typeof HttpRequestNodeSchema>;

// ================= WorkflowNode 联合定义 =================

export const WorkflowNodeSchema = Type.Union([
  // P0 (11)
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
  // P1 (10)
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
]);

export type WorkflowNode = Static<typeof WorkflowNodeSchema>;

// ================= WorkflowEdge 与 WorkflowDSL =================

export const WorkflowEdgeSchema = Type.Object({
  id: Type.String(),
  source: Type.String(),
  target: Type.String(),
  sourceHandle: Type.Optional(Type.String()),
  targetHandle: Type.Optional(Type.String()),
  branch: Type.Optional(Type.String()),
});

export type WorkflowEdge = Static<typeof WorkflowEdgeSchema>;

export const WorkflowDSLSchema = Type.Object({
  version: Type.Literal("dsh.workflow.v1"),
  name: Type.String({ minLength: 1 }),
  nodes: Type.Array(WorkflowNodeSchema),
  edges: Type.Array(WorkflowEdgeSchema),
});

export type WorkflowDSL = Static<typeof WorkflowDSLSchema>;
