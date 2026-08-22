# 架构设计 — dsh-workflow-mode

> v0.1.2：经对抗性审查修订 —— 边契约泛化、变量求值双模式、preset 隔离域对齐官方规范、运行快照改 structuredClone。

## 1. 模式定位矩阵

| 模式 | 核心驱动 | 状态管理 | 确定性 | 场景 |
|------|---------|---------|--------|------|
| 标准 Standard | ReAct 循环 | 线性对话历史 | 中 | 开放式研发 |
| PTC Code | 单轮 TS 批量执行 | 沙箱临时变量 | 中高 | 批量吞吐 |
| 极简 Minimal | bash + str_replace_editor | 极简上下文 | 基准 | Benchmark |
| 创造 Cordis | 自修改运行时 | 运行时动态 | 探索 | 插件开发 |
| **工作流 Workflow** | **确定性 DAG 调度** | **Run 级显式变量池** | **极高** | **SOP / CI-CD / 固定批处理** |

## 2. 分层拓扑

```
DSH Web GUI
  └─ @deepseek-ai/dsh-client-ui-workflow（client 插件，经 dsh.client 清单声明挂载 Slot，
     由聚合包 web-ui-all 安装；画布为 @xyflow/react，渲染节点状态色）
        │ WS changed/invalid/nodeStatus + 文件 watcher 双向同步
.dsh/workflows/*.json —— 单一真值来源（TypeBox Schema 校验门）
        │ 加载与校验
Workflow Preset（Agent 平面）
  ├─ cordis:group [isolate: workflowEngine]      ← 键名对齐官方预设既有约定
  │    ├─ dsh-workflow-runner                    引擎服务：拓扑调度/并发/重试/structuredClone 快照
  │    ├─ tool-workflow-controller               模型工具：list/validate/run/status/stop/approve/resume/logs/history/test/reload
  │    └─ tool-ask-user                          Human 断点通道
        │ 只消费 Host 平面，绝不重复注册：
LLM(dsh-llm) │ tools 注册表 │ Worker 沙箱(codeRuntime) │ subagents 注册表 │ webserver(webhook 路由)
```

## 3. 两层平面约束（对齐本地源码 config/agent-presets/*/agent.cordis.yml 实测规范）

- **Host 平面**（base/web.cordis.yml）：registries、sandbox、model route、subagents 单例。本方案**不新增任何 Host 服务**——GUI 与 api-proxy 一律通过文件系统与既有注册表读取状态，避免跨平面解析失败。webhook 触发亦复用既有 Host webserver 固定路由 `/api/workflows/webhook/:name`（校验后派发事件给引擎），Preset 不自行注册端点。
- **Agent 平面**：
  - 引擎是 preset 私有服务 → 必须置于 `cordis:group`，isolate 键**复用官方命名** `workflowEngine`（standard/cordis 预设已用此键承载 worker-thread，语义一致，避免未声明服务的 ctx.get 抛错）。
  - `tool-workflow-controller` 是纯模型工具：只向 host tools 目录注册、不 provide 服务，与官方 delegation 组内工具行做法一致，可安全共处同一组内。
  - 同进程多会话各持 entry-local 实例；mount 时由 dsh-agent-presets 校验无根域冲突。

## 4. 节点体系 v2（参考 Dify / Coze / n8n：5 层 21 种 = P0 基线 11 种 + P1 扩展 10 种）

| 层 | 节点 | 期次 | 对标来源 | 复用机制 |
|----|------|------|---------|---------|
| 触发 | start | P0 | n8n Manual Trigger | 注入全局入参 |
| | schedule_trigger | P1 | n8n Schedule | cordis-plugin-timer cron |
| | webhook_trigger | P1 | n8n Webhook | host 固定路由接入；timingSafeEqual HMAC + body ≤1MB + 时间戳防重放 ≤300s |
| 控制 | if_else | P0 | 三家 Condition | 表达式上下文求值（见 §5） |
| | switch | P1 | n8n Switch | 多 case 出边（sourceHandle 路由） |
| | iteration | P0 | Coze 批处理 / n8n SplitInBatches | 子图映射 + p-queue 限流 |
| | wait | P1 | n8n Wait | timer 服务 |
| | merge | P1 | Dify Variable Aggregator | 多前驱输出按 key 归并 |
| | human | P0 | Dify 人机交互 | ask-user 挂起恢复 + 超时降级（见下） |
| | error_fallback | P1 | n8n Error Trigger | 接收 `onError:"route"` 的失败转储 |
| AI | llm | P0 | 三家核心 | dsh-llm + outputSchema 强约束 |
| | intent_classifier | P1 | Dify QuestionClassifier / Coze 意图识别 | 轻量模型 + 枚举路由 |
| | parameter_extractor | P1 | Dify ParameterExtractor | 结构化抽取 |
| | subagent | P0 | Coze Agent 节点 | host subagents spawn/fork |
| | sub_workflow | P1 | n8n ExecuteWorkflow | 引擎递归实例（深度上限 3） |
| 数据胶水 | code | P0 | 三家均有 | Worker 线程沙箱 |
| | template | P0 | Dify Template | Mustache 渲染 |
| | set_variable | P0 | n8n Set | 变量池写操作（生产 SOP 最低门槛，故入 P0） |
| | http_request | P1 | 三家标配 | undici fetch，超时+重试 |
| 系统 | plugin_tool | P0 | —— DSH 特有 | host tools 注册表反射 |
| 输出 | end | P0 | Dify End / Coze 结束 | 汇总返回 |

通用机制（借鉴要点）：
- **节点级 `onError` 策略**：`stop(P0) | continue(P0) | route(P1，须连 error_fallback)`。
- **声明式批处理**：iteration 外，llm/http/plugin_tool 支持 `batch:{input, parallelism}`。
- **Human 节点完整协议**：`timeoutMs` + `onTimeout: abort|proceed`；审批回传 payload `{ decision:"approved"|"rejected", inputs? }`，inputs 合并写回 Run 级变量池（支持审批时修正参数）。等待状态持久化于 run.json，进程重启后可从检查点恢复等待。

## 5. 变量流协议 v2（求值双模式，杜绝类型坍塌与注入）

DSL 中凡引用上游输出，按**字面形态**自动选择求值模式：

| 写法 | 模式 | 结果 |
|------|------|------|
| 值恰为一个占位符：`"{{#node.prop#}}"` | **直接引用** | 返回原始 JsonValue（对象/数组/数值保型传递） |
| 占位符混排常量文本 | **文本插值** | 字符串替换；非字符串值走 JSON.stringify |
| if_else / switch 的条件字段 | **表达式上下文求值** | `expr-eval.Parser.evaluate(expr, vars)`，vars 以节点 id 为变量名注入原始值；**禁止先做文本拼接再 eval**（防 HIGH 裸标识符崩溃与引号注入） |

示例：`"condition": "audit.riskLevel == 'HIGH'"` —— audit 的输出对象作为上下文变量参与求值，riskLevel 保持字符串字面量语义。
大体积中间产物只存在于 Run 级 VariableContext；下游 LLM 仅注入被引用字段 → 无上下文污染、单节点可原地重试。

### 5.1 分支汇聚与死路径消除（DPE，P0 必备）

条件分叉后直接汇聚到同一下游节点（fork-join）是合法拓扑（见 §6 示例 deploy 的双入边），但朴素的入度归零调度会**永久死锁**——未命中分支的入边永远不激活。因此引擎必须实现 DPE 令牌传播：

- 未命中的分支出边向下游传播 `SKIPPED` 令牌；
- 节点入度计数只统计**非 SKIPPED** 入边：收到 SKIPPED 边时从待等待计数中扣除；
- 全部入边均 SKIPPED → 该节点被跳过（status=skipped），并继续向其后继传播 SKIPPED；
- 至少一条有效入边完成、其余均 SKIPPED → 立即触发执行（OR-Join 语义）。

该语义为 P0 引擎能力，不依赖 P1 的 merge 节点。

## 6. DSL 示例（dsh.workflow.v1）

```json
{
  "version": "dsh.workflow.v1",
  "name": "代码检出-审计-部署",
  "nodes": [
    { "id": "start", "type": "start", "inputs": { "repo_url": { "type": "string" }, "env": { "type": "string", "default": "production" } } },
    { "id": "git_clone", "type": "plugin_tool", "toolName": "tool-bash", "onError": "stop", "inputs": { "command": "git clone {{#start.repo_url#}} ./repo && cd ./repo && git diff HEAD~1" } },
    { "id": "extract", "type": "code", "code": "return inputs.diff.split('\\n').filter(l => l[0]==='+'||l[0]==='-').join('\\n');", "inputs": { "diff": "{{#git_clone.stdout#}}" } },
    { "id": "audit", "type": "llm", "model": "deepseek-reasoner", "prompt": "审计并给风险等级：{{#extract.result#}}", "outputSchema": { "type": "object", "properties": { "riskLevel": { "enum": ["HIGH","MEDIUM","LOW"] } }, "required": ["riskLevel"] } },
    { "id": "gate", "type": "if_else", "condition": "audit.riskLevel == 'HIGH'" },
    { "id": "confirm", "type": "human", "prompt": "发现高危，继续部署 {{#start.env#}}？", "timeoutMs": 3600000, "onTimeout": "abort" },
    { "id": "deploy", "type": "plugin_tool", "toolName": "dsh-ssh", "action": "ssh_exec", "inputs": { "alias": "{{#start.env#}}", "command": "cd /app && git pull && pm2 reload app" } },
    { "id": "end", "type": "end", "outputs": { "status": "success" } }
  ],
  "edges": [
    { "id": "e1", "source": "start", "target": "git_clone" },
    { "id": "e2", "source": "git_clone", "target": "extract" },
    { "id": "e3", "source": "extract", "target": "audit" },
    { "id": "e4", "source": "audit", "target": "gate" },
    { "id": "e5", "source": "gate", "target": "confirm", "branch": "true" },
    { "id": "e6", "source": "gate", "target": "deploy", "branch": "false" },
    { "id": "e7", "source": "confirm", "target": "deploy" },
    { "id": "e8", "source": "deploy", "target": "end" }
  ]
}
```

边契约：`id` 必填（React Flow 需要）；`sourceHandle/targetHandle` 可选，供 switch 多路出边与错误路由使用；`branch` 为任意字符串标签（if_else 固定产生 "true"/"false"，switch 产生自定义 case，error_fallback 入边约定 "error"）。
示例中 deploy 的双入边（e6 未命中分支 + e7 审批链）由 §5.1 DPE 语义消解，不会死锁。

## 7. 人机分工模型

- **AI**：0→1 生成 JSON；拓扑重构；Code 节点异常自愈（edit 原地修复）。
- **人**：画布视觉审阅；Prompt 微调；Human 断点审批（含参数修正回填）。
- 双方以同一 JSON 文件为真值来源，watcher 保证 ≤2s 同步。

## 8. 依赖复用清单

| 用途 | 选型 |
|------|------|
| 画布 | @xyflow/react（Dify/Langflow 同款底层） |
| DAG | graphlib + p-queue |
| 表达式 | expr-eval（上下文求值模式） |
| 校验 | TypeBox（与 DSH 工具 schema 栈一致） |
| 快照 | structuredClone（Node ≥17 内置） |
| 文件监听 | chokidar |

## 9. AI 调试闭环（创建 → 读日志 → 修改 → 再跑）

> 设计原则：**日志落盘为纯文件，Agent 用既有 read/grep/edit 工具即可完成全闭环**；controller 仅提供便捷封装。

### 9.1 运行产物目录与保留策略

```
.dsh/workflows/runs/<workflow-name>/<runId>/
├─ run.json          # 元数据：状态/入参/起止时间/各节点耗时/Human 等待检查点
├─ events.jsonl      # 状态迁移事件流（可 grep/tail）
└─ nodes/<nodeId>.json  # 节点输入输出快照（超长截断：head 4KB + tail 1KB；iteration 内为 <id>.<index>.json）
```

<workflow-name> 为 slug 清洗后的目录名（仅 [a-zA-Z0-9_-]，取文件 basename）；DSL name 字段仅展示用，防路径穿越。

**保留策略（防磁盘/Inode 耗尽）**：每工作流默认保留最近 100 次 run 或 7 天（先到为准）；引擎启动时与每次 run 结束后执行惰性清理，阈值可在 preset 配置覆盖。

**并发隔离**：VariableContext 为 **run 级实例**（每次 run 以 runId 独立创建）；同一工作流被 webhook/schedule 并发触发时互不可见、落盘目录天然隔离。

### 9.2 Controller 动作集

```
list / validate / run / status / stop            ← P0
approve {runId, nodeId, decision:"approved"|"rejected", inputs?}  ← P0：向挂起的 human 节点提交审批结果，inputs 回填变量池
resume  {runId}                                  ← P0：进程重启后从 run.json 检查点恢复（含 waiting_human）
logs    {runId, nodeId?, tail?}                  ← 读 events.jsonl 尾部 N 条
history {name?, limit}                           ← 最近 N 次 run 摘要
test    {file, nodeId, inputs}                   ← 单节点干跑：mock 输入，不产生正式 run
reload  {file}                                   ← 手动触发热重载（watcher 兜底入口）
```

### 9.3 典型自愈循环

```
Agent 创建/修改 JSON (write/edit)
  → run → 失败 → logs 读 events.jsonl 定位节点
  → read nodes/<id>.json 看真实输入输出
  → edit 修该节点 code/prompt/参数
  → test 单节点干跑通过 → 整图 run → 成功沉淀
```

## 10. 热重载机制（直改文件的正确性保障）

```
fs.watch(.dsh/workflows/*.json) ──debounce 300ms──► TypeBox 校验
        │ 通过                                     │ 失败
        ▼                                         ▼
  原子替换内存中的 DSL 注册表              保留 last-good 版本
  广播 WS {event:"workflow.changed"}       广播 WS {event:"workflow.invalid", errors}
  画布 ≤2s 自动刷新                        画布标红错误路径 + controller 下次调用可见
```

- **运行隔离（ExecutionInstance 快照）**：run 启动时对 DSL 做 `structuredClone` 深拷贝，生成独立的执行实例状态机；节点状态/计时/路由分支全部写在实例上，与只读的注册表 DSL 物理隔离。**不使用 Object.freeze**（冻结会导致引擎写状态时抛 TypeError）。文件中途被改不影响进行中的 run，下一次 run 才使用新版。
- **双通道一致性**：人改画布保存文件、Agent 用 edit 改文件，走同一条 watcher 通路，无第二套同步逻辑。
- **兜底**：watcher 异常时可由 Agent 显式调 `reload` action 强制重建注册表。