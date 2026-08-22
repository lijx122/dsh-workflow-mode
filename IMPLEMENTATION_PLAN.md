# 实施计划 — dsh-workflow-mode

## 项目概述
- 项目名：dsh-workflow-mode（DSH 工作流模式）
- 需求文档：[REQUIREMENTS.md](./REQUIREMENTS.md)
- 架构文档：[ARCHITECTURE.md](./ARCHITECTURE.md)
- 当前阶段：**T6 进行中（DSH 集成绑定层：plugin_tool/llm/subagent/human）**
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

### [已完成] T4 DAG 引擎核心
> 拆两棒执行。**T4a 已完成**：调度骨架（graphlib+p-queue、Run 级隔离、六态状态机、stop 队列语义、失败传播、maybeFinish 三路完结）——commit 947f033 → d2d72b9，审查修复 S1(stop 后积压任务仍启动)与 B1/B2/B3/B5；23/23 全绿。
> **T4b 已完成**：AbortSignal 熔断传播、retry/backoff、超时熔断、DPE 死路径消除、structuredClone 图快照——commit b24baff → e9886b8（复审修复：超时同步 aborted 标志 + stopRequested 语义拆分），30/30 全绿。

### [已完成] T4b DAG 引擎核心·第二棒
- 依赖：T4a
- 产物：AbortSignal→executor/Worker 传播；retry:{max,backoffMs}；defaultNodeTimeoutMs 超时熔断；DPE SKIPPED 令牌传播（入度扣减/OR-Join/skipped 终态）；run 启动 structuredClone 图快照（文件热改不影响进行中 run）
- 验收标准：FR-05 四项验收全过（含 DPE fork-join 无死锁）；t4b.spec.ts 六例（超时/默认超时/重试/DPE 双向/快照/stop→abort）全绿
- 关联接口：NodeExecutor 协议、ExecutionContext；路由节点输出约定 { branch: string }（引擎按 branch 激活 if_else 命中出边）

### [已完成] T5 基础节点执行器（P0 11 种）
- 依赖：T4
- 产物：engine/src/executors/ 7 纯逻辑执行器 + 4 stub（human/llm/subagent/plugin_tool 待 T6）；onError stop|continue 引擎侧支持；code 执行器经三轮安全加固（vm realm 内建隔离 + inputs 字符串跨界 + primordial 清理 + deepFreeze 环防护 + 失败即终止）
- 验收标准：FR-06 达成——沙箱逃逸探针（Date/Math/RegExp/inputs 嵌套 constructor 链）全部封死，64/64 测试全绿
- 变更影响：新增 executors 目录与 code-worker 双文件结构；iteration body 形态严格化与 schema 收敛一致
- 锚点：commit 4178d01 → cbd723c → 3563d92；安全复审两轮 APPROVED

### [已完成] T6 DSH 集成绑定层
- 依赖：T4（与 T5 可并行）
- 产物：四执行器（human/llm/subagent/plugin_tool）改为经 ctx.host 取用注入服务：Engine 构造可选 options.host: HostServices{tools?,llm?,subagents?,askUser?}并导出；缺失即抛 hostNotBound 指引错误；llm outputSchema 文本解析 + JSON Schema 子集校验（type/required/properties/items/enum/additionalProperties:false）；human 三路径（approved 回填 inputs / rejected 失败 / timeoutMs+onTimeout abort|proceed）+ signal abort 立即拒绝
- 验收标准：FR-06——test/t6.spec.ts 26 例（mock host 四执行器各≥2 例 + human 三路径 + llm schema 校验失败）全绿；engine 97/97 全绿（含既有 64 例）
- 变更影响：executors/errors.ts 由 NotImplementedError 扩展 hostNotBound；executors.spec.ts 原 4 条 stub 断言改为 host 绑定断言；EngineOptions 新增 host 字段
- 关联接口：ExecutionContext.host（HostServices）

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