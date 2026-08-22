# 实施计划 — dsh-workflow-mode

## 项目概述
- 项目名：dsh-workflow-mode（DSH 工作流模式）
- 需求文档：[REQUIREMENTS.md](./REQUIREMENTS.md)
- 架构文档：[ARCHITECTURE.md](./ARCHITECTURE.md)
- 当前阶段：**T4 进行中（DAG 引擎核心，拆 T4a 调度骨架 / T4b 熔断重试DPE隔离）**
- v0.1.2：经对抗性审查修订接口契约与任务依赖图

---

## 接口定义

> 所有模块的公共接口在此定义。实现时严格遵守签名和返回结构。
> 接口变更必须经主对话审批后才能修改此处。

### workflow-schema → engine / gui（共享契约）

```ts
/** dsh.workflow.v1 顶层 DSL（TypeBox 定义，同时导出 JSON Schema） */
interface WorkflowDSL {
  version: "dsh.workflow.v1";
  name: string;
  nodes: WorkflowNode[];   // 可辨识联合（定义见下）；node.id 必须匹配 ^[a-zA-Z_][a-zA-Z0-9_]*$（表达式变量名安全），且全图唯一
  edges: WorkflowEdge[];
}

type NodeType =
  | "start"|"end"|"if_else"|"iteration"|"human"|"llm"|"subagent"
  | "code"|"template"|"set_variable"|"plugin_tool"                       // P0（11 种含 start/end）
  | "switch"|"wait"|"merge"|"error_fallback"                             // P1
  | "schedule_trigger"|"webhook_trigger"
  | "intent_classifier"|"parameter_extractor"|"sub_workflow"|"http_request";

type OnError = "stop" | "continue" | "route";   // stop/continue=P0；route=P1 且须连 error_fallback

interface WorkflowEdge {
  id: string;                    // 必填（React Flow 需要）
  source: string;
  target: string;
  sourceHandle?: string;         // switch 多 case 出边 / 错误路由出口
  targetHandle?: string;
  branch?: string;               // 任意字符串标签：if_else→"true"|"false"；error_fallback 入边约定 "error"
}

/** WorkflowNode = 可辨识联合（以 type 判别）。通用字段 id/type/onError?/retry?/timeoutMs?；
 *  inputs 为可选键值入参（plugin_tool/code/iteration/template 等需要映射的节点使用）；
 *  各类型专有顶层字段示例：
 *    IfElseNode.condition | LLMNode.{model,prompt,outputSchema?} | HumanNode.{prompt,timeoutMs?,onTimeout?}
 *    EndNode.outputs | CodeNode.{code,inputs?} | SwitchNode.cases | SetVariableNode.assignments
 *  Schema 按 type 分支校验专有字段，禁止把专有配置塞进 inputs 混用。 */
type WorkflowNode =
  | StartNode | EndNode | IfElseNode | IterationNode | HumanNode | LLMNode
  | SubagentNode | CodeNode | TemplateNode | SetVariableNode | PluginToolNode
  | SwitchNode | WaitNode | MergeNode | ErrorFallbackNode | ScheduleTriggerNode
  | WebhookTriggerNode | IntentClassifierNode | ParameterExtractorNode
  | SubWorkflowNode | HttpRequestNode;

/** 校验结果：错误必须可定位（JSON Path + 人读原因） */
interface ValidateResult {
  ok: boolean;
  errors: { path: string; code: "SCHEMA"|"DANGLING_EDGE"|"CYCLE"|"UNKNOWN_NODE_TYPE"|"DUPLICATE_NODE_ID"|"INVALID_NODE_ID"; message: string }[];
}
function validateWorkflow(raw: unknown): ValidateResult;
```

### variable-context → engine（Run 级变量总线，同步 API）

> T3 实现裁决（2026-08-16）：① 占位符语法定为 `{{#nodeId.prop}}`（无尾 #）；② 注入安全策略 = 条件求值经 vars 传值，expr-eval 字符串字面量不支持转义引号，DSL 内避免在表达式中写含引号字面量（比较经变量引用完成）；③ JsonValue 类型由 engine 包定义并导出（null|boolean|number|string|数组|递归对象）。expr-eval 逻辑运算符为 and/or/not（非 &&/||），T5 if_else 执行器须遵守。

```ts
/** 每次运行以 runId 独立实例化；并发多运行（Run）互不可见 */
class VariableContext {
  set(nodeId: string, outputs: Record<string, JsonValue>): void;
  /** 直接引用：值恰为 "{{#node.prop#}}" 时返回原始 JsonValue（保型）；未定义节点/循环引用抛 WorkflowVarError(path) */
  ref(template: string): JsonValue;
  /** 表达式上下文求值：vars 以节点 id 为变量名注入原始值；禁止文本拼接后求值 */
  evalExpr(expr: string): JsonValue;
  /** 文本插值：占位符混排常量时使用；非字符串走 JSON.stringify */
  interpolate(s: string): string;
}
```

### graph-engine → 全部执行器（节点执行协议）

```ts
interface ExecutionContext {
  runId: string;
  nodeId: string;
  signal: AbortSignal;                 // stop/超时熔断必须经此传播到 Worker/子进程/网络请求
  log(event: RunEvent): void;          // 写入 events.jsonl
  varCtx: VariableContext;
  callStack?: string[];                // sub_workflow 调用栈：压栈校验深度 ≤3 且拒绝环路
  host: {
    tools: ToolRegistryRef;            // plugin_tool 反射调用
    llm: LLMServiceRef;                // llm / intent_classifier / parameter_extractor
    subagents: SubagentRegistryRef;    // subagent 节点
    codeRuntime: CodeRuntimeRef;       // code 节点 Worker 沙箱
  };
}

interface NodeExecutor {
  type: NodeType;
  execute(node: WorkflowNode, inputs: Record<string, JsonValue>, ctx: ExecutionContext): Promise<NodeOutput>;
}
interface NodeOutput { [key: string]: JsonValue }
type NodeStatus = "pending"|"running"|"success"|"failed"|"waiting_human"|"skipped";
```

### tool-workflow-controller → model（工具 schema）

```json
{ "action": "list|validate|run|status|stop|approve|resume|logs|history|test|reload", "file?": ".dsh/workflows/<name>.json", "runId?": "string", "nodeId?": "string", "params?": {} }
```
返回：list→文件数组；validate→ValidateResult；run→{runId}；status→{nodes:[{id,status}], startedAt}；stop→{stopped:boolean}；approve→{nodeId, decision, resumed:boolean}；resume→{resumed:boolean, nodes:[{id,status}]}；logs→{events:[RunEvent]}；history→[{runId,status,startedAt}]；test→NodeOutput；reload→{version:number}
注：approve/resume 属 P0——human 为 P0 节点，缺二者则断点无法闭合。

### 日志与检查点契约（engine ↔ 落盘 ↔ controller.logs/resume 共享）

```ts
interface RunEvent {
  timestamp: number;
  runId: string;
  type: "run_start" | "run_finish" | "node_start" | "node_finish"
      | "node_error" | "node_skip" | "human_wait";
  nodeId?: string;
  data?: Record<string, JsonValue>;   // 截断规则同 nodes/<id>.json（head 4KB + tail 1KB）
}

/** run.json 结构 = 断点持久化真值（approve/resume 依据它恢复） */
interface RunCheckpoint {
  runId: string;
  workflowName: string;
  status: "running" | "success" | "failed" | "waiting_human" | "stopped";
  startedAt: number;
  finishedAt?: number;
  inputs: Record<string, JsonValue>;
  nodeStates: Record<string, {
    status: NodeStatus;
    startedAt?: number;
    finishedAt?: number;
    error?: string;
    outputs?: Record<string, JsonValue>;  // 已完成节点全量输出快照：resume/approve 据此水合变量池（nodes/<id>.json 有截断，不可作数据源）
    waitingData?: JsonValue;          // human 等待时的审批请求快照
  }>;
}
```

### P0 节点专有字段（可辨识联合分支定义，其余 P1 类型在 T10 前补齐同格式）

```ts
StartNode        { inputs: Record<string, { type: "string"|"number"|"boolean"|"object", required?, default? }> }
EndNode          { outputs?: Record<string, string /* 变量引用 */> }
IfElseNode       { condition: string }                                  // expr-eval 表达式
IterationNode    { over: string; maxIterations?: number/*默认500,超限拒绝*/; maxConcurrency?: number/*默认5*/; body: WorkflowDSL["nodes"] | { nodes: WorkflowNode[]; edges: WorkflowEdge[] } }
HumanNode        { prompt: string; timeoutMs?: number; onTimeout?: "abort"|"proceed" }
LLMNode          { model?: string; prompt: string; systemPrompt?: string; outputSchema?: JsonSchema }
SubagentNode     { prompt: string; preset?: string; backgroundMode?: "one-shot" }
CodeNode         { code: string; inputs?: Record<string, string> }      // Worker+node:vm 隔离执行
TemplateNode     { template: string; inputs?: Record<string, string> }
SetVariableNode  { assignments: Array<{ key: string; value: string /* 变量引用或字面量 */ }> }  // 键值数组，保序写入
PluginToolNode   { toolName: string; action?: string; inputs?: Record<string, JsonValue> }
```

### gui ↔ host（同步事件）

```
WS push { event: "workflow.changed", file }                      // 文件被 Agent/人修改且校验通过
WS push { event: "workflow.invalid", file, errors }              // 校验失败，画布标红，引擎保留上一可用版本 (last-good)
WS push { event: "workflow.nodeStatus", runId, nodeId, status }
```

### Web client 插件契约（T8 交付物之一，对齐 dsh-client-modules 真实加载器）

```json
// packages/dsh-client-ui-workflow/package.json —— 字段以 parseDshClient 实测校验为准
{
  "name": "@deepseek-ai/dsh-client-ui-workflow",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" }
  },
  "dsh": {
    "client": {
      "platform": "web",
      "inject": ["@deepseek-ai/dsh-client-ui-slots", "@deepseek-ai/dsh-client-runtime"]
    }
  }
}
```
硬性约束（违反即宿主启动抛 ClientPackageCompositionError）：`platform` 必填字符串；`inject` 必须是**依赖模块名数组**而非文件路径；bundle 入口走 `exports["./client"]`。视图挂载不在 package.json 声明——运行时经 `slots.register(...)` 注册工作区视图 Slot（viewId=workflow-canvas），与会话/运行视图路由切换；随 web-ui-all 聚合包安装生效。

---

## 任务依赖关系

```
主线：
T1 脚手架 → T2 Schema/校验器 → T3 变量总线 → T4 DAG 引擎核心 → T5 基础执行器(11种+onError) → T6 DSH 集成节点 → T7 Preset 集成验证 ─┐
                                                                                                                                    │
并行支线 A：T2 ────────────► T8 Web GUI 画布 + client 插件契约（可与 T4-T7 并行）──────────────────────────────────────────────────┤
并行支线 B：T5+T6 ─────────► T10 扩展节点集（P1）                                                                                  ├─► T9 端到端收尾
并行支线 C：T7 ────────────► T11 运行日志持久化与调试接口                                                                          │
并行支线 D：T2+T4+T8 ──────► T12 文件热重载 ──────────────────────────────────────────────────────────────────────────────────────┘
```
说明：T12 的快照/换版核心在引擎（故依赖 T4）；画布消费 changed/invalid 事件（故依赖 T8）。T7 与 T8 无相互依赖，仅在 T9 汇合。

---

## 任务列表

### [已完成] T1 项目脚手架与包结构
- 依赖：无
- 产物：packages/dsh-workflow-schema、dsh-workflow-engine、dsh-client-ui-workflow 三包骨架；根 tsconfig/pnpm-workspace
- 验收标准：`pnpm install && pnpm -r build` 通过，三包均可空构建成功
- 关联接口：无
- 变更影响：新增全部骨架文件；实际目录名为 packages/{schema,engine,client-ui-workflow}
- 锚点：commit 58aced7；Reviewer 双阶段审查 PASS

### [已完成] T2 DSL Schema 与校验器
- 依赖：T1
- 产物：packages/schema/src/{dsl.ts, validate.ts}；单测 validate.spec.ts
- 验收标准：FR-03 五类错误（缺字段/悬空连线/环路/重名 id/非法 id 字符）用例全绿；错误含 JSON Path
- 关联接口：WorkflowDSL、WorkflowEdge、validateWorkflow
- 变更影响：定义 TypeBox DSL Schema 与 validateWorkflow 校验器；经质量审查修复环路检测假阳性（S1）与弱断言（S2），附带清理 R3-R7；空白 name 回归已修
- 锚点：commit 2f123e8 → c8201ce → 901366e；复审 APPROVED；14/14 测试通过

### [已完成] T3 变量总线与求值双模式
- 依赖：T2
- 产物：engine/src/{variable-context.ts, errors.ts}；单测 variable-context.spec.ts（14 例）
- 验收标准：FR-04 全部用例通过（含对象保型直传与表达式注入防护）
- 关联接口：VariableContext（ref/evalExpr/interpolate，同步）
- 变更影响：engine 新增依赖 expr-eval 与 @dsh-workflow/schema；占位符语法裁决为无尾 #（计划已补注）；expr-eval 运算符差异记入契约注；保留字冲突登记 D5
- 锚点：commit 259d73a → 68c9396（原型链泄漏安全修复+正则收紧+undefined防御）；复审 APPROVED；engine 17/17 + schema 14/14 全绿

### [待办] T4 DAG 引擎核心
- 依赖：T3
- 产物：engine/src/engine.ts（graphlib+p-queue）；AbortSignal 熔断；structuredClone ExecutionInstance；DPE 死路径消除令牌传播（SKIPPED 扣减入度/OR-Join）；并发/重试/超时/双运行隔离/fork-join 无死锁单测
- 验收标准：FR-05 四项验收全过（含 DPE）
- 关联接口：NodeExecutor 协议、ExecutionContext

### [待办] T5 基础节点执行器（P0 11 种）
- 依赖：T4
- 产物：engine/src/executors/{start,end,if_else,iteration,human,llm,subagent,code,template,set_variable,plugin_tool}.ts；onError(stop/continue) 节点级策略；code 执行器 = Worker 线程 + node:vm 隔离 Context + AbortSignal→worker.terminate() 强制熔断；每执行器 ≥1 单测
- 验收标准：FR-06——11 执行器单测全绿；human 三路径（通过/超时中止 abort/回填 inputs）；code 沙箱逃逸用例与 while(true) 死循环超时熔断用例通过
- 关联接口：NodeExecutor、OnError

### [待办] T6 DSH 集成绑定层
- 依赖：T4（与 T5 可并行）
- 产物：executors 对 host 服务（tools 注册表/dsh-llm/subagents/ask-user）的绑定适配
- 验收标准：FR-06——plugin_tool 用 tool-fs 真实读写通过
- 关联接口：ExecutionContext.tools

### [待办] T7 Preset 配置与 cordis 挂载验证
- 依赖：T5+T6
- 产物：config/agent-presets/workflow/{preset.yml, agent.cordis.yml}（isolate 键=workflowEngine，无新增 Host 服务）；tool-workflow-controller 插件（P0 七动作，含 approve/resume）
- 验收标准：FR-01/02——模式切换器出现工作流模式；双会话无 realm 冲突；controller 七动作可用
- 关联接口：controller schema

### [待办] T8 Web GUI 画布与 client 插件契约
- 依赖：T2（Schema）；可与 T4-T7 并行
- 产物：packages/dsh-client-ui-workflow（@xyflow/react + dsh.client 清单声明 slot）；watcher→WS 推送
- 验收标准：FR-08 渲染 8+ 节点拓扑；FR-09 Agent 改 JSON 后画布 ≤2s 刷新
- 关联接口：gui↔host 同步事件、Web client 插件契约

### [待办] T10 扩展节点集（P1，10 种）
- 依赖：T5+T6
- 产物：switch/wait/merge/error_fallback/intent_classifier/parameter_extractor/sub_workflow/http_request 执行器 + schedule_trigger/webhook_trigger 绑定；onError 扩展 route；batch 声明式批处理
- 验收标准：FR-11 全部单测通过；error_fallback 注入故障按 route 改道；webhook 无效鉴权 401、超 1MB body 413、过期时间戳 401；sub_workflow 经 ExecutionContext.callStack 校验深度 ≤3 且拒绝环路
- 关联接口：NodeType（P1 枚举）、OnError("route")

### [待办] T11 运行日志持久化与调试接口
- 依赖：T7
- 产物：run 三件套落盘 + 保留策略清理器；controller 增加 logs/history/test/reload
- 验收标准：FR-12（含 105 次历史 run 清理断言）；FR-13 四条 Mock 断言全部脚本化通过
- 关联接口：controller schema（十一动作全集）、RunEvent、RunCheckpoint

### [待办] T12 文件热重载
- 依赖：T2+T4+T8
- 产物：chokidar watcher、debounce 校验管线、上一可用版本（last-good）回退、WS changed/invalid 事件
- 验收标准：FR-14 三项断言全过
- 关联接口：gui↔host 同步事件

### [待办] T9 端到端示例与收尾
- 依赖：T7+T8+T10+T11+T12
- 产物：examples/workflows/ 两个示例 JSON；运行日志留存；CHANGELOG v0.1.0
- 验收标准：FR-10 两示例各完整跑通一次并留存日志；FR-01～FR-14 全部勾验完毕
- 关联接口：全部

状态标记：[待办] [进行中] [已完成] [阻塞:原因]