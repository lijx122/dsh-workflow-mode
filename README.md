# dsh-workflow-mode

> DeepSeek Harness 第 5 种 Agent Preset —— 工作流模式（Workflow Mode）

## 一句话定位

以 **JSON DSL 为单一真值来源**、**Agent 负责生成/修改 JSON**、**Web GUI React Flow 画布负责可视化审阅**、**Cordis 插件体系负责确定性 DAG 执行** 的人机协作自动化流水线模式。

## 核心特性

- **确定性 DAG 执行**：拓扑排序调度，节点级显式变量流（`{{#node_id.output}}`），无上下文污染。
- **Agent 直改 JSON**：自然语言一句话编排/重构/自愈工作流，无需手动拖拽。
- **DSH 插件原生映射**：已安装插件（tool-bash / dsh-ssh / task-board 等）自动反射为 Plugin Tool 节点。
- **人机断点协同**：高危操作前 Human 节点暂停，等待 GUI 审批后继续。

## 文档索引

| 文档 | 内容 |
|------|------|
| [REQUIREMENTS.md](./REQUIREMENTS.md) | 功能需求清单（FR 编号逐条验收） |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 架构设计：平面分层、节点体系、DSL 规范 |
| [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) | 实施计划：接口契约、任务依赖、任务列表 |
| [TECH_DEBT.md](./TECH_DEBT.md) | 技术债清单 |
| [CHANGELOG.md](./CHANGELOG.md) | 变更与回滚记录 |

## 产物结构

```
dsh-workflow-mode/
├─ packages/
│  ├─ schema/                 # @dsh-workflow/schema: DSL Schema 与 validateWorkflow 校验器
│  ├─ engine/                 # @dsh-workflow/engine: DAG 引擎核心与 21 节点执行器
│  ├─ client-ui-workflow/     # @dsh-workflow/client-ui-workflow: Web GUI React Flow 画布插件
│  └─ workflow-controller/    # @dsh-workflow/workflow-controller: 控制器十一动作、热重载与保留策略
├─ config/agent-presets/workflow/ # Preset 注册
└─ examples/workflows/            # 示例工作流 (ci-deploy.json, batch-report.json)
```
