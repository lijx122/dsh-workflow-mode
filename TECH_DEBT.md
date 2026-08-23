# 技术债清单

> 记录所有已知的临时方案、跳过的功能、已知缺陷。
> 高风险条目累计 3 条时，必须在下个任务开始前处理至少 1 条。

| ID | 来源 | 描述 | 风险(低/中/高) | 建议处理时机 | 状态 | 处理锚点 |
|----|------|------|---------------|-------------|------|---------|
| D1 | 设计评审 | code 节点每次冷启动 Worker 线程，高频小任务延迟与开销偏大；未做线程池预热 | 中 | T5 完成后压测，若 P95 超 200ms 则引入常驻 worker 池 | 待处理 | - |
| D2 | 设计评审 | Windows 下 chokidar 对原子写（临时文件 rename）可能触发双事件/抖动；debounce 300ms 是缓解而非根治 | 中 | T12 实现时加内容哈希去重校验 | 待处理 | - |
| D3 | 设计评审 | schedule_trigger 复用 cordis-plugin-timer，调度存活于进程/GUI 会话——浏览器标签页关闭或进程退出则错过即跳过（同 dsh-task-board 既有限制） | 高 | v0.2 演进：迁移至 host 常驻调度或落盘补偿队列 | 待处理 | - |
| D4 | T2 审查 | iteration.body 嵌套子图（nodes/edges 结构）递归校验延后至 T5/T10，当前仅做宽松 Type.Any 类型校验 | 中 | T5 或 T10 实现时补齐 | 待处理 | - |
| D5 | T3 实现 | 节点 id 允许与 expr-eval 保留字重名（如 true/if/in），此类节点在 evalExpr 中不可被引用 | 低 | T10 前：schema 校验增加保留字黑名单，或 evalExpr 对 vars 键做安全前缀映射 | 待处理 | - |
| D6 | Studio v2.1 裁决#1/§10-P0.1 | 客户端 contract 无模型读写 API：LLM 节点模型选择降级为只读展示会话当前模型，仅提示词可编辑 | 中 | M2 实现期探测 dsh-client-ui-model-selection 数据源；宿主未来暴露 RPC 后升级 | 待处理 | design §10.1 |
| D7 | Studio v2.1 裁决#3 | http_request 节点移出本期范围：浏览器 fetch 必撞 CORS 且无宿主中继证据 | 中 | 宿主提供代理通道后再纳入 | 待处理 | design §10.3 |
| D8 | Studio v2.1 裁决#16 | code 节点沙箱用 new Function + 冻结白名单，非 Worker 隔离，存在逃逸面 | 中 | 引入 Worker/blob 沙箱或复用引擎 vm worker | 待处理 | design §10.16 |
| D9 | Studio v2.1 裁决#16 | iteration 仅内联子队列串行循环，无并行调度；fork-join 视觉保留执行串行 | 中 | 引擎并行调度能力就绪后接入 | 待处理 | design §10.16 |
| D10 | M2 复验 F3b | LLM temperature / subagent workspace 字段引擎不消费（orchestrator 仅传 prompt/systemPrompt；session-executor workspaceId 按 node.id 派生忽略 inputs.workspace），面板无降级提示 | 中 | 会话联调期透传字段或面板加提示 | 待处理 | src/run/orchestrator.ts:347 |
| D11 | M2 复验 F3a | 生产画布未传 measured，layout-v2 仅估算布线（xyflow 实测高度不回灌），复杂节点可能重叠 | 低 | 接入 useStore 实测回灌重排 | 待处理 | src/canvas-parts/studio-canvas.tsx:52 |
| D12 | M2 复验 F3c | MiniMap 视口框用 window 尺寸近似容器尺寸，宿主非全窗时偏大 | 低 | 真机微调：改读 React Flow 容器 rect | 待处理 | src/canvas-parts/minimap.tsx:56 |擎并行调度能力就绪后接入 | 待处理 | design §10.16 |

## 登记规则

- 任何临时方案、跳过的功能、已知缺陷，完成任务时必须同步登记到此表。
- 处理完成后更新状态并记录 commit hash。
- 高风险 ≥3 条：下个任务前强制消化至少 1 条。