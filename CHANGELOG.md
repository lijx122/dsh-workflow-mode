# 变更记录

## Unreleased

### 修复
- Fixed retention.spec.ts ENOENT flaky test (added mkdirSync for wfRunDir) so retention lazy-cleanup test now passes reliably.

## v0.2.0-workflow-studio（2026-08-23）

### 新增
- **工作流工作台（Workflow Studio）**：Dify/Coze 式可视化 DAG 编辑器，作为 DSH Web 客户端插件随「工作流模式」预设自动启用（PresetGate 门控：非 workflow 会话零侵入）。
  - 三栏布局：宿主侧边栏不动 | 中部画布（初始宽按 §10.5 公式解析，6px 玻璃分隔条可拖拽，localStorage v2 记忆+视口重钳制）| 右侧属性面板（380–600px）。
  - **节点系统**（M2）：12 类 DSL 节点四件套（default/card/panel/types），NODE_REGISTRY 统一注册；类型识别色条+图标 chip+徽章+等宽副标题差异化卡片；六态运行视觉（pending/running/completed/failed/skipped/waiting_human）；自绘缩放胶囊与 MiniMap 替代 React Flow 原生控件；block-selector 三分组加节点浮层。
  - **执行编排器**（M3）：RunOrchestrator 拓扑串行调度、onError stop/continue/route、死路消除 skipped 传播、AbortSignal ✕ 语义、iteration 内联子队列循环；code 节点沙箱（静态扫描拒 constructor/__proto__/eval + null 原型 inputs + 冻结白名单 shadow）；LLM/Subagent 经真实 DSH 会话驱动（exempt 会话豁免门控，try/finally 配对）；human 断点 waiting_human 两态 + approveHuman 端到端恢复闭环。
  - **工作流库**（M4）：localStorage CRUD + 模版播种（仅一次）+ 坏值 .bak 自愈 + 配额静默降级 + 导入导出（强制过 validateWorkflow）。
- 双主题令牌层：逐字采用 dsh-client-ui-theme 官方浅/深色值（品牌蓝 #4176e6/#679efe），跟随宿主 data-ds-dark-theme 自动切换；生产 CSS 禁用 color-mix。
- 设计文档 v2.1（docs/design/workflow-studio-design.md，含 §10 对抗审查裁决 21 条）与高保真基准图 docs/design/workflow-studio-mockup.html。

### 修复
- 修复 persona 提示词字面 {{#nodeId.prop}} 触发 DSH 模板变量校验失败导致会话首步报错（改写为自然语言描述）。
- 修复客户端插件 apply 幂等守卫缺卸载释放导致的 HMR 后无法重挂（claim/release 经 ctx.effect 成对注册）。
- 修复 Studio 容器接管时 createRoot 第二根叠加风险（__dswWorkflowRoot 根标记协议）。

### 质量
- 全流程多子代理对抗性审查：设计评审 REVISE→修订；四模块编码各自经独立对抗审查（累计 9 轮审查，拦截 P0×7/P1×11，含 effect 回调泄漏、双根叠加、外点丢改名、沙箱逃逸、方言漂移、approveHuman 断链），全部以复验 APPROVE 收口。
- 测试：client-ui-workflow 包 192 用例全绿（registry/布局公式/门控豁免/沙箱攻击面/端到端断点恢复等）；全仓 tsc 0 错误；pnpm -r build exit 0。

### 已知问题
- TECH_DEBT D6-D12（模型选择 API 缺失降级只读、http_request 移出本期、code 沙箱非 Worker 隔离残余 import/Promise 面、iteration 无并行、temperature/workspace 引擎不消费、生产画布估算布线、MiniMap window 近似视口框）。

### 回滚方式
- `git checkout <v0.1.0-dev 锚点>`；服务器回滚：`cd /opt/dsh-workflow-mode && git checkout 0479576 && pnpm -r build && cp config/agent-presets/workflow/* /root/.dsh/.agent-presets/workflow/ && pm2 restart dsh-web`

# 变更记录

## v0.1.0-dev（2026-08-16）

### 新增
- **全阶段任务交付完成（T1～T12）**：全仓 176 测试 100% 通过（packages/schema: 16，packages/engine: 128，packages/client-ui-workflow: 11，packages/workflow-controller: 21）。
- **T1 项目脚手架**（锚点 `58aced7`）：pnpm workspace + TS 5.6 + ESM + Vitest 测试环境。
- **T2 Schema 与校验器**（锚点 `2f123e8`，fix `c8201ce`, `901366e`）：TypeBox DSL Schema 与 `validateWorkflow` 校验器（环路检测、悬空连线、重名与非法 ID 拦截）。
- **T3 变量总线**（锚点 `259d73a`，fix `68c9396`）：Run 级独立 `VariableContext`，支持保型直接引用、文本插值与 `expr-eval` 上下文表达式求值，阻断原型链穿透。
- **T4 DAG 引擎核心与调度**（锚点 `947f033`/`b24baff`，fix `d2d72b9`/`e9886b8`）：拓扑排序、DPE（死路径消除/OR-Join）、p-queue 限流调度、重试退避、超时熔断与 structuredClone 执行实例隔离。
- **T5 P0 节点执行器与沙箱**（锚点 `4178d01`，fix `cbd723c`/`3563d92`）：Start/End/IfElse/Iteration/Human/LLM/Subagent/Code/Template/SetVariable/PluginTool 11 种节点；Worker + `node:vm` 物理隔离沙箱与 `terminate()` 熔断。
- **T6 DSH 服务绑定层**（锚点 `994c9fc`，fix `1c03d3a`）：依赖注入模式 `HostServices` 适配器（tools/llm/subagents/askUser/resolveWorkflow）。
- **T7 Workflow Controller**（锚点 `4eef3d9`）：11 个动作全面支持（list/validate/run/status/stop/approve/resume/logs/history/test/reload）与 preset 骨架。
- **T8 Web GUI React Flow 画布**（锚点 `6016daf`）：基于 @xyflow/react 的可视画布，支持 21 种节点图标映射、六态运行状态色、分支边标签与拓扑自动分层。
- **T10 P1 扩展节点集**（锚点 `205db66`）：Switch/Wait/Merge/ErrorFallback/ScheduleTrigger/WebhookTrigger/IntentClassifier/ParameterExtractor/SubWorkflow/HttpRequest 10 种扩展节点，支持 route 错误改道与声明式 batch 批处理。
- **T11 运行日志持久化与保留清理器**（锚点 `17324bc`）：`RetentionCleaner`（100 次 run / 7 天保留策略，超限与过期惰性清理，快照截断与 slug 安全清洗）。
- **T12 文件热重载**（锚点 `ae80c0b`）：`WorkflowFileWatcher`（chokidar 监听、300ms 防抖、SHA-1 哈希去重、last-good 校验失败回退与版本原子递增）。
- **T9 端到端示例与集成测试**：
  - `examples/workflows/ci-deploy.json`（代码检出-审计-人工审批-部署流水线，含 DPE 分支消除与 Human 断点回填）
  - `examples/workflows/batch-report.json`（批量文件清洗-变量汇总-模板报告生成）
  - `packages/workflow-controller/test/e2e.spec.ts`（3 个端到端测试覆盖 HIGH 风险审批通过、LOW 风险 DPE 跳过、批量清洗与模板渲染断言）

### 修复
- 修复 Code 节点 VM 沙箱在 Object.prototype / 跨 realm 访问逃逸问题。
- 修复 if_else 分叉汇聚在朴素入度调度下的死锁（DPE 令牌传播与 OR-Join）。
- 修复 human 节点在 abort/timeout race 后的 timer 句柄清理防止钉住事件循环。
- 修复 watcher 在重复写入相同内容时的防抖哈希去重。

### 回滚方式
- 命令：`git checkout v0.1.0-dev` 或检出前置锚点 commit

## v0.1.5-plan（2026-08-16）

### 新增
- 第四轮对抗性子代理复审：**无 Critical 阻塞项，裁定「可以进入交付开发环节，从 T1 启动」**
- 复审建议的两处接口细化当场落地：RunCheckpoint.nodeStates.outputs（重启水合变量池的全量快照源）、ExecutionContext.callStack（sub_workflow 深度/环路校验）
- IterationNode.body 类型放宽为可表达多节点子图（nodes+edges）

### 修复
- 无代码（纯文档阶段）

### 已知问题
- TECH_DEBT D1-D3

### 回滚方式
- 尚未建立版本控制；文档级回滚：恢复 v0.1.4-plan 版本文档

## v0.1.4-plan（2026-08-16）

### 新增
- 第三轮对抗性子代理复审（1 Critical / 4 Major / 1 Minor），全部闭环：
- [C] Code 节点安全模型重定义：Worker 线程内 node:vm 独立 Context（屏蔽 process/require/fs/net），AbortSignal 强制 worker.terminate() 物理熔断；新增沙箱逃逸与死循环熔断验收用例
- [M] Webhook 平面冲突消解：复用 Host webserver 固定路由，不新增 Host 服务；安全规范补齐 timingSafeEqual / body≤1MB(413) / 时间戳防重放 ≤300s(401)
- [M] 接口契约补全：RunEvent、RunCheckpoint、P0 全部 11 种节点专有字段定义
- [M] 文档同步回归修复：NodeStatus 补 skipped、ValidateResult 补 INVALID_NODE_ID、T2 五类错误/T7 七动作/T11 十一动作对齐
- [M] iteration 资源上限（maxIterations=500 / maxConcurrency=5 / 迭代快照防覆盖命名）；ExecutionContext.callStack 支撑 sub_workflow 深度与环路校验
- [N] run 目录名 slug 清洗防路径穿越

### 修复
- 无代码（纯文档阶段）

### 已知问题
- TECH_DEBT D1-D3

### 回滚方式
- 尚未建立版本控制；文档级回滚：恢复 v0.1.3-plan 版本文档

## v0.1.3-plan（2026-08-16）

### 新增
- 第二轮对抗性子代理复审：确认第一轮 14 项全部闭环，新发现 2 Critical / 3 Major / 1 Minor，本轮全部闭环：
- [C] Web client 插件契约按 dsh-client-modules 真实加载器重写：platform 必填、inject=模块名数组、入口走 exports["./client"]、视图运行时 slots.register（原格式会触发 ClientPackageCompositionError）
- [C] 引擎新增 DPE 死路径消除语义（SKIPPED 令牌扣减入度 / OR-Join），修复 §6 示例 fork-join 拓扑在朴素拓扑排序下的永久死锁
- [M] WorkflowNode 改为按 type 判别的可辨识联合，专有顶层字段与可选 inputs 明确分离
- [M] controller 补 approve/resume 两个 P0 动作（human 断点闭环与重启恢复）
- [M] ExecutionContext 注入 host 服务组 {tools, llm, subagents, codeRuntime}
- [N] node.id 正则约束 ^[a-zA-Z_][a-zA-Z0-9_]*$ + DUPLICATE_NODE_ID 错误码
- 同步更新：ARCHITECTURE §2/§5.1/§6/§9.2、REQUIREMENTS FR-02/03/05/08、IMPLEMENTATION_PLAN 接口区与 T4/T7

### 修复
- 无代码（纯文档阶段）

### 已知问题
- TECH_DEBT D1-D3

### 回滚方式
- 尚未建立版本控制；文档级回滚：恢复 v0.1.2-plan 版本文档

## v0.1.2-plan（2026-08-16）

### 新增
- 首轮对抗性子代理审查（产出 5 Critical / 6 Major / 3 Minor），全部闭环：
- [C] 边契约泛化：edge 必含 id，branch 放开为任意字符串标签，新增 sourceHandle/targetHandle（支撑 switch 多路与错误路由）
- [C] preset 平面修正：不新增 Host 服务；isolate 键复用官方 workflowEngine；controller 仅注册 host tools 目录
- [C] 变量求值双模式：直接引用保型 / 文本插值 / 表达式上下文求值（禁止文本拼接后 eval，防类型坍塌与注入）
- [C] Web client 插件契约：dsh.client 清单声明 inject/slot/viewId（对齐 dsh-task-board 安装模型）
- [C] ExecutionContext 强制携带 AbortSignal（stop/超时熔断可传播）
- [M] 节点计数修正：全集 21 种 = P0 基线 11 种 + P1 扩展 10 种；set_variable 与 onError(stop/continue) 提前至 P0
- [M] 任务依赖图重绘（消除反向箭头）；T12 补 T4 前置依赖
- [M] deep-freeze 改为 structuredClone ExecutionInstance 快照
- [M] Human 节点补全协议：timeoutMs / onTimeout / 审批回传 {decision, inputs?} / 等待状态持久化恢复
- [M] VariableContext 明确 run 级实例化；日志保留策略（100 次 run 或 7 天惰性清理）
- [M] FR-13 验收改为四条脚本化 Mock 断言（去除不可判定的「≤5 次工具调用」统计指标）
- [N] VariableContext API 同步化；TECH_DEBT 初始登记 D1-D3

### 修复
- 无代码（纯文档阶段）

### 已知问题
- TECH_DEBT D1-D3（引用对应 ID）

### 回滚方式
- 尚未建立版本控制；文档级回滚：恢复 v0.1.1-plan 版本文档

## v0.1.1-plan（2026-08-16）

### 新增
- 节点体系升级 v2：参考 Dify / Coze / n8n 扩展至 5 层 18 种（P0 基线 10 种 + P1 扩展 8 种），引入触发器分层、节点级 onError 策略与声明式批处理（ARCHITECTURE §4）
- AI 调试闭环设计：运行产物三件套落盘（run.json / events.jsonl / nodes/*.json），controller 新增 logs / history / test / reload 动作（ARCHITECTURE §9，FR-12/13）
- 文件热重载机制：watcher → 校验 → last-good 回退 → WS 双事件广播；run 图 deep-freeze 运行隔离（ARCHITECTURE §10，FR-14）
- 实施计划新增任务 T10（扩展节点集）/ T11（日志与调试接口）/ T12（热重载），T9 收尾依赖相应扩展

### 修复
- 无

### 已知问题
- 无

### 回滚方式