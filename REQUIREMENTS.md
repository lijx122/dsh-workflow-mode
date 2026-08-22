# 需求文档 — dsh-workflow-mode

> 实施时逐条交付，不允许标记 TODO 跳过；有阻塞必须回传说明。
> 每条 FR 的「验收标准」是唯一完成判据。
> v0.1.2：经对抗性审查修订（求值双模式、Human 超时协议、run 级隔离、日志保留策略、验收确定性化）。

---

## R1 预设与运行时集成

### FR-01 工作流 Preset 注册
- 提供 `config/agent-presets/workflow/preset.yml`（name=工作流模式, order=5）与 `agent.cordis.yml`。
- 平面约束：**不新增 Host 服务**；引擎置于 `cordis:group` 且 isolate 键复用官方命名 `workflowEngine`；controller 等工具行仅注册 host tools 目录、不 provide 服务。
- **验收**：DSH 启动后模式切换器出现「工作流模式」；同进程开 2 个 workflow 会话无 realm 冲突报错；GUI 能读取到 run 状态（经文件/WS，而非解析 Agent 平面服务）。

### FR-02 Workflow Controller 工具
- 新工具 `tool-workflow-controller`：模型可调用 `list / validate / run / status / stop / approve / resume` 七个 P0 action（approve 提交 human 审批结果并回填 inputs；resume 在进程重启后从检查点恢复挂起 run）。
- **验收**：validate 非法 DSL 返回结构化错误（含 JSON Path）；run 合法 DSL 后 status 查询到节点级状态；human 挂起后经 approve 恢复且 inputs 回填生效。

## R2 DSL 与校验

### FR-03 DSL Schema 定义
- 定义 `dsh.workflow.v1` JSON Schema：nodes[]、edges[]、version、name 四个顶层字段。
- 节点为按 type 分支的可辨识联合，通用字段 id/type 必填（专有字段见各类型定义）；node.id 匹配 `^[a-zA-Z_][a-zA-Z0-9_]*$` 且全图唯一（保证表达式变量名安全）；边必填 **id**/source/target，可选 sourceHandle/targetHandle/branch(任意字符串标签)。
- **验收**：校验器对缺字段、悬空连线、环路、重名 id（DUPLICATE_NODE_ID）、非法 id 字符五类输入分别返回可定位错误信息（JSON Path + 人读原因）。

### FR-04 变量引用与求值双模式
- 直接引用：值恰为 `{{#node.prop#}}` 时返回原始 JsonValue（保型）；
- 文本插值：占位符混排常量时字符串替换，非字符串走 JSON.stringify；
- 条件表达式（if_else/switch）：上游输出作为 expr-eval 上下文变量求值，**禁止文本拼接后 eval**。
- **验收**：单测覆盖六类用例——合法引用、未定义节点、循环引用、对象保型直传、字符串条件含引号的注入防护、表达式上下文求值正确性。

## R3 执行引擎

### FR-05 DAG 引擎核心
- 基于 graphlib + p-queue：拓扑排序、环路拒绝、就绪节点并发调度（默认 maxParallelNodes=8）。
- 节点失败支持重试配置（retry:{max, backoffMs}）与超时（defaultNodeTimeoutMs）；取消/超时经 AbortSignal 传播到底层 Worker/子进程/网络请求。
- **Run 隔离**：每次 run 以 runId 独立实例化 VariableContext 与 structuredClone 图快照；同一工作流并发多 run 互不干扰。
- **死路径消除（DPE）**：条件分叉未命中分支向下游传播 SKIPPED 令牌；入度计数扣除 SKIPPED 边；全 SKIPPED 则跳过该节点并继续传播；部分有效则 OR-Join 触发执行——fork-join 合法拓扑不得死锁。
- **验收**：①含并行分支的 10 节点图正确执行且并发 ≤8；②注入失败节点按 retry 重跑；③同一工作流同时发起 2 次 run（不同入参），结果互不串扰；④if_else 双分支汇聚下游节点的图在 true/false 两路径下均完整执行无死锁。

### FR-06 节点执行器（P0 基线 11 种）
| type | 行为 |
|------|------|
| start | 校验并注入全局入参 |
| end | 汇总输出并终止 |
| if_else | 表达式上下文求值（FR-04），路由 branch="true"/"false" 出边 |
| iteration | 对数组输入串行/并行映射子执行；maxIterations 默认 500（超限拒绝启动），maxConcurrency 默认 5（p-queue 限流）；迭代内快照命名 nodes/<id>.<iterationIndex>.json 防覆盖竞争 |
| human | ask-user 挂起等待；支持 timeoutMs + onTimeout(abort/proceed)；审批回传 {decision, inputs?} 且 inputs 合并回变量池；等待状态持久化，进程重启后可恢复 |
| llm | 单节点独立 model/prompt/outputSchema 调用 dsh-llm |
| subagent | 经 host subagents 注册表 spawn/fork，回收结构化结果 |
| code | Worker 线程内以 node:vm 独立 Context 执行：屏蔽 process/require/fs/net 等原生能力，仅注入 inputs 与只读基础对象（Math/JSON/Date/RegExp）；AbortSignal 触发 worker.terminate() 物理熔断（死循环/超时/手动 stop 均销毁线程） |
| template | Mustache 文本拼装 |
| set_variable | 变量池写操作（字段编辑/重命名/常量注入） |
| plugin_tool | 按 toolName 反射调用 host tools 注册表 |

- 全部节点支持 `onError: stop(P0) | continue(P0)`；route 至 error_fallback 归 P1（FR-11）。
- **验收**：每类执行器 ≥1 单测；plugin_tool 用 tool-fs 做真实读写验证；human 用例覆盖「审批通过」「审批超时 abort」「审批时回填 inputs」三路径；code 沙箱逃逸用例（尝试 require('fs')/访问 process 必须抛错）与 while(true) 死循环在超时后被 terminate 且不残留活动句柄。

### FR-07 变量总线隔离
- 中间大体积数据仅存在于 Run 级 VariableContext；LLM 节点上下文只注入被引用的精简字段。
- **验收**：构造 code→llm 流水线，断言发送给模型的 prompt 仅包含过滤后内容。

## R4 Web GUI

### FR-08 可视化画布
- 基于 @xyflow/react 的 client 插件 `@deepseek-ai/dsh-client-ui-workflow`：package.json 按 dsh.client 真实 schema 声明（platform="web"、inject=模块名数组、bundle 入口走 exports["./client"]），视图经运行时 slots.register 注册至工作区 Slot；加载 .dsh/workflows/*.json 渲染节点卡片与连线（含边 id/handle），节点显示类型图标与运行状态色（pending/running/success/failed/waiting_human/skipped）。
- **验收**：插件安装后宿主正常启动（无 ClientPackageCompositionError）；画布能打开示例工作流并正确渲染 8+ 节点拓扑。

### FR-09 双向同步
- 人（画布保存）/ Agent（edit 工具）共用同一 JSON 文件为真值来源；文件变更经 watcher 推送画布刷新。
- **验收**：Agent 修改 JSON 后 ≤2s 内画布反映变更，无需手动刷新页面。

## R5 交付物

### FR-10 示例与文档
- 至少 2 个端到端示例：①代码审计-人工确认-部署流水线；②批量文件清洗-汇总报告。
- **验收**：示例在真实 DSH 会话中完整跑通一次并留存运行日志。

## R6 扩展节点集（P1）

### FR-11 扩展 10 种节点
- switch（多路 case 出边）、wait、merge（变量聚合）、error_fallback + onError 扩展至 `route`；
- schedule_trigger（cron）、webhook_trigger——经 **Host webserver 既有固定路由** `/api/workflows/webhook/:name` 接入（不新增 Host 服务）：HMAC 签名必须 crypto.timingSafeEqual 恒定时间比较、请求体硬上限 maxBodyBytes=1MB、时间戳防重放（时钟漂移容限 ≤300s）；
- intent_classifier、parameter_extractor、sub_workflow（递归深度上限 3）、http_request。
- AI 类节点支持声明式批处理 `batch:{input, parallelism}`。
- **验收**：每节点 ≥1 单测；含 error_fallback 的图在注入故障时按 route 改道且主流程不崩；webhook 无效鉴权返回 401。

## R7 AI 调试闭环

### FR-12 运行日志持久化与保留策略
- 每次 run 落盘 `.dsh/workflows/runs/<name>/<runId>/{run.json, events.jsonl, nodes/<id>.json}`；节点快照超长截断（head 4KB + tail 1KB），保证 Agent 用 read/grep 可直接消费。
- 保留策略：每工作流最近 100 次 run 或 7 天（先到为准），引擎启动时与 run 结束后惰性清理。
- 落盘目录名 `<workflow-name>` 取工作流文件 basename 并经 slug 清洗（仅保留 [a-zA-Z0-9_-]）；DSL 的 name 字段仅作展示，不参与拼路径（防路径穿越）。
- **验收**：任一 run 结束后三件套齐全且可被 grep 定位失败节点；构造 105 次历史 run 后断言清理生效。

### FR-13 调试动作（确定性验收）
- controller 增加 logs / history / test（单节点干跑）/ reload 动作。
- **验收（可自动化判定）**：编写 Mock 故障夹具——①预置一个必失败的 code 节点图，断言 logs 在单次调用中返回该节点的失败事件与错误消息全文；②断言 nodes/<id>.json 含真实入参快照；③对同节点以修正后的 mock 输入调 test 返回 success 且不产生新 run 目录；④reload 后注册表版本号递增。四条断言全部脚本化，Pass/Fail 由测试框架判定，不依赖模型行为统计。

## R8 文件热重载

### FR-14 watcher 双通道同步
- chokidar 监听 .dsh/workflows/*.json，debounce 300ms → 校验 → 通过则原子换版并广播 changed；失败则保留 last-good 并广播 invalid（含错误路径）。
- **ExecutionInstance 快照**：run 启动时 structuredClone 整图生成独立执行实例；运行中文件修改不影响进行中的 run，下一次 run 生效。
- **验收**：三项断言——①≤2s 刷新；②运行中改图当前 run 结果不受影响且下一 run 用新版；③写入非法 JSON 时画布标红且引擎仍可用旧版执行成功。