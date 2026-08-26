---
name: n8n-workflow
description: n8n 2.x 工作流规范说明（JSON 拓扑、节点坐标与连线规则）、典型拓扑范例（DAG 与 AI Agent/Tool/Model 连线）、以及 Agent 免密 REST API（Zero-Auth）操作指南（CRUD、触发执行、获取执行结果）。当用户需要设计、导出、修改、生成、调试或自动化操作与执行 n8n 工作流时使用此 skill。
metadata:
  short-description: n8n 2.x 工作流规范、拓扑生成与 Agent Zero-Auth REST 编排接口
---

# n8n 2.x 工作流规范与 Agent 自动化编排指南

本指南面向 DSH Agent，定义了 n8n 2.x 工作流的标准 JSON 格式、节点定义与连线拓扑规则，并提供无需鉴权（Zero-Auth）直接通过本地 REST API 操作与执行工作流的完整契约。

---

## 一、工作流标准 JSON 结构

n8n 工作流顶层为单一 JSON 对象：

```json
{
  "name": "工作流名称",
  "nodes": [ /* Node 对象数组 */ ],
  "connections": { /* 拓扑连线字典 */ },
  "settings": {
    "executionOrder": "v1",
    "saveManualExecutions": true,
    "callerPolicy": "workflowsFromSameOwner",
    "timezone": "Asia/Shanghai"
  },
  "pinData": {}
}
```

### 1. Node（节点）定义
每个节点必须包含全局唯一 UUID、节点名称、类型、版本、画布坐标及参数：
```json
{
  "id": "a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d",
  "name": "节点显示名称",
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [240, 300],
  "parameters": {
    "jsCode": "return [{ json: { msg: 'hello' } }];"
  }
}
```

### 2. 常用节点类型清单
- **触发器 (Triggers)**：
  - `n8n-nodes-base.manualTrigger` (v1)：手动点击执行
  - `n8n-nodes-base.scheduleTrigger` (v1.2)：定时 / Cron 触发
  - `n8n-nodes-base.webhook` (v2)：Webhook 接收器 (GET/POST)
  - `@n8n/n8n-nodes-langchain.chatTrigger` (v1.1)：聊天对话触发
- **逻辑与基础 (Logic & Base)**：
  - `n8n-nodes-base.code` (v2)：执行 JavaScript / Python
  - `n8n-nodes-base.if` (v2.2)：条件分支
  - `n8n-nodes-base.switch` (v3.2)：多路路由
  - `n8n-nodes-base.httpRequest` (v4.2)：HTTP / REST 请求
- **AI 与 LangChain 生态**：
  - `@n8n/n8n-nodes-langchain.agent` (v1.7)：AI Agent 执行中枢
  - `@n8n/n8n-nodes-langchain.lmChatOpenAi` (v1.2)：OpenAI 兼容模型接入
  - `@n8n/n8n-nodes-langchain.lmChatDeepSeek` (v1)：DeepSeek 官方模型接入
  - `@n8n/n8n-nodes-langchain.toolCode` (v1.1)：Agent 自定义代码工具
  - `@n8n/n8n-nodes-langchain.toolHttpRequest` (v1.1)：Agent 动态 HTTP 工具
  - `@n8n/n8n-nodes-langchain.toolCalculator` (v1)：计算器工具

### 3. 画布坐标排布算法 (DAG Layout)
为保证在 UI 画布上清晰不重叠，Agent 生成节点时遵循以下坐标规则：
- **主流程（横向链路）**：
  - 起点节点：`[240, 300]`
  - 后续节点：`X_next = X_curr + 260`, `Y_next = Y_curr`
  - 分支节点：`X_branch = X_curr + 260`, `Y_branch = Y_curr + 180`（向下偏移）
- **AI 附属节点（Model / Tool / Memory）**：
  - 垂直挂载在对应 Agent 节点正下方：
  - Model 节点：`[Agent.X - 100, Agent.Y + 180]`
  - Tool 1 节点：`[Agent.X + 100, Agent.Y + 180]`
  - Tool 2 节点：`[Agent.X + 280, Agent.Y + 180]`

---

## 二、Connections（连线拓扑）规范

`connections` 字典以**源节点的 `name`** 为键，定义输出端口类型及目标节点数组：

```json
{
  "connections": {
    "定时触发": {
      "main": [
        [
          { "node": "数据提取与清洗", "type": "main", "index": 0 }
        ]
      ]
    },
    "DSH 模型": {
      "ai_languageModel": [
        [
          { "node": "AI 总结 Agent", "type": "ai_languageModel", "index": 0 }
        ]
      ]
    },
    "计算器工具": {
      "ai_tool": [
        [
          { "node": "AI 总结 Agent", "type": "ai_tool", "index": 0 }
        ]
      ]
    }
  }
}
```

### 连线类型与关键规则
1. **`main`**：普通数据流/控制流连线（从上游输出连接到下游输入）。
2. **`ai_languageModel`**：模型连接至 Agent 的模型插槽。
3. **`ai_tool`**：工具节点（如 Calculator、Code Tool、Custom HTTP Tool）连接至 Agent 的工具插槽。
4. **`ai_memory`**：记忆节点连接至 Agent。
5. **名称严格绑定**：所有键名与 `node` 目标名称必须与 `nodes` 数组中的 `name` 字段严格一致；修改节点名称必须同步修改 `connections`。

---

## 三、典型工作流拓扑范例

### 范例 1：定时任务 -> 代码清洗 -> 模型分析 -> Webhook/HTTP 输出
```json
{
  "name": "定时数据清洗与模型分析流水线",
  "nodes": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "name": "Schedule Trigger",
      "type": "n8n-nodes-base.scheduleTrigger",
      "typeVersion": 1.2,
      "position": [240, 300],
      "parameters": {
        "rule": { "interval": [{ "field": "cronExpression", "expression": "0 9 * * *" }] }
      }
    },
    {
      "id": "22222222-2222-4222-8222-222222222222",
      "name": "Fetch & Clean Data",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [500, 300],
      "parameters": {
        "jsCode": "return [{\n  json: {\n    metric: 'daily_active_users',\n    value: 12500,\n    growth: '+14.2%',\n    reportDate: new Date().toISOString().split('T')[0]\n  }\n}];"
      }
    },
    {
      "id": "33333333-3333-4333-8333-333333333333",
      "name": "HTTP Request Output",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [760, 300],
      "parameters": {
        "method": "POST",
        "url": "https://httpbin.org/post",
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify($json) }}"
      }
    }
  ],
  "connections": {
    "Schedule Trigger": {
      "main": [[{ "node": "Fetch & Clean Data", "type": "main", "index": 0 }]]
    },
    "Fetch & Clean Data": {
      "main": [[{ "node": "HTTP Request Output", "type": "main", "index": 0 }]]
    }
  },
  "settings": { "executionOrder": "v1" }
}
```

### 范例 2：Chat 触发 -> AI Agent -> DSH Chat Model + Calculator & Code Tool
```json
{
  "name": "Chat AI Agent 复合工具调用流",
  "nodes": [
    {
      "id": "aaaa1111-0000-4000-8000-000000000001",
      "name": "Chat Trigger",
      "type": "@n8n/n8n-nodes-langchain.chatTrigger",
      "typeVersion": 1.1,
      "position": [240, 300],
      "parameters": {}
    },
    {
      "id": "aaaa2222-0000-4000-8000-000000000002",
      "name": "AI Agent",
      "type": "@n8n/n8n-nodes-langchain.agent",
      "typeVersion": 1.7,
      "position": [500, 300],
      "parameters": {
        "promptType": "define",
        "text": "={{ $json.chatInput }}",
        "options": {
          "systemMessage": "你是一个资深数据分析助手，可调用计算器和代码工具进行高精度分析。"
        }
      }
    },
    {
      "id": "aaaa3333-0000-4000-8000-000000000003",
      "name": "DSH Chat Model",
      "type": "@n8n/n8n-nodes-langchain.lmChatOpenAi",
      "typeVersion": 1.2,
      "position": [400, 480],
      "parameters": {
        "model": "deepseek-chat",
        "options": {
          "temperature": 0.2
        }
      },
      "credentials": {
        "openAiApi": {
          "id": "dsh_gateway",
          "name": "DSH OpenAI Gateway"
        }
      }
    },
    {
      "id": "aaaa4444-0000-4000-8000-000000000004",
      "name": "Calculator",
      "type": "@n8n/n8n-nodes-langchain.toolCalculator",
      "typeVersion": 1,
      "position": [580, 480],
      "parameters": {}
    },
    {
      "id": "aaaa5555-0000-4000-8000-000000000005",
      "name": "Code Tool",
      "type": "@n8n/n8n-nodes-langchain.toolCode",
      "typeVersion": 1.1,
      "position": [760, 480],
      "parameters": {
        "name": "data_formatter",
        "description": "格式化数据为 Markdown 表格",
        "jsCode": "return JSON.stringify(query);"
      }
    }
  ],
  "connections": {
    "Chat Trigger": {
      "main": [[{ "node": "AI Agent", "type": "main", "index": 0 }]]
    },
    "DSH Chat Model": {
      "ai_languageModel": [[{ "node": "AI Agent", "type": "ai_languageModel", "index": 0 }]]
    },
    "Calculator": {
      "ai_tool": [[{ "node": "AI Agent", "type": "ai_tool", "index": 0 }]]
    },
    "Code Tool": {
      "ai_tool": [[{ "node": "AI Agent", "type": "ai_tool", "index": 0 }]]
    }
  },
  "settings": { "executionOrder": "v1" }
}
```

---

## 四、Zero-Auth 本地 REST API 操作契约

在当前纯净版 n8n 服务中，后端已接入 Zero-Auth 机制（本地请求自动以 Instance Owner 身份执行），无需任何 Cookie 或 API Key 即可全功能调用。同时内置超级管理员凭据供静默双轨鉴权保底：
- **内置超级管理员账号**：`Email: admin@123.cc` / `Password: admin123`（兼容 `admin@n8n.local` / `admin123456`）
- **画板双向热同步机制**：Agent 编写或修改工作区 `.dsh/workflows/*.json` 文件后，控制器内部 `WorkflowFileWatcher` 会自动解析拓扑并调用 n8n 本地 API 导入/更新工作流，画布前端无感实时呈现最新节点拓扑。

### 1. 核心 API 端点速查
| 功能 | Method | URL | 关键入参 / 说明 |
| :--- | :--- | :--- | :--- |
| **查询所有工作流** | `GET` | `http://127.0.0.1:5678/rest/workflows` | 返回 `{ count: number, data: Workflow[] }` |
| **查询指定工作流** | `GET` | `http://127.0.0.1:5678/rest/workflows/:id` | 返回工作流完整结构与版本号 |
| **创建工作流** | `POST` | `http://127.0.0.1:5678/rest/workflows` | Body: `{ name, nodes, connections, settings }` |
| **更新工作流** | `PATCH` | `http://127.0.0.1:5678/rest/workflows/:id` | Body: `{ name, nodes, connections, settings }` |
| **删除工作流** | `DELETE` | `http://127.0.0.1:5678/rest/workflows/:id` | 删除工作流 |
| **激活工作流** | `POST` | `http://127.0.0.1:5678/rest/workflows/:id/activate` | Body: `{}` |
| **停用工作流** | `POST` | `http://127.0.0.1:5678/rest/workflows/:id/deactivate` | Body: `{}` |
| **执行工作流** | `POST` | `http://127.0.0.1:5678/rest/workflows/:id/run` | Body: `{ triggerToStartFrom: { name: "..." } }` 或 `{ destinationNode: { nodeName: "...", mode: "inclusive" } }` |
| **查询执行结果** | `GET` | `http://127.0.0.1:5678/rest/executions/:id` | 返回执行状态 `finished/running/error` 及节点输出数据 |

---

## 五、Agent 自动化执行与结果获取脚本

Agent 可直接通过 Node.js（或 PowerShell）快速实现「创建 -> 执行 -> 轮询结果」全闭环：

```javascript
// 示例：创建工作流、触发执行并提取节点输出
const BASE_URL = 'http://127.0.0.1:5678';

async function runWorkflowPipeline(workflowPayload) {
  // 1. 创建工作流
  const createRes = await fetch(`${BASE_URL}/rest/workflows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(workflowPayload)
  });
  const workflow = await createRes.json();
  const workflowId = workflow.id;
  console.log(`Workflow created: ${workflowId} (${workflow.name})`);

  // 2. 触发手动执行（以第一个触发节点或首个节点开始）
  const triggerNode = workflow.nodes[0].name;
  const runRes = await fetch(`${BASE_URL}/rest/workflows/${workflowId}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      triggerToStartFrom: { name: triggerNode }
    })
  });
  const runData = await runRes.json();
  const executionId = runData.executionId;
  console.log(`Execution started: ${executionId}`);

  // 3. 轮询获取执行结果
  let finished = false;
  let executionResult = null;
  while (!finished) {
    await new Promise(r => setTimeout(r, 1000));
    const execRes = await fetch(`${BASE_URL}/rest/executions/${executionId}`);
    executionResult = await execRes.json();
    if (executionResult.finished) {
      finished = true;
    }
  }

  // 4. 解析结果数据
  console.log('Execution finished successfully:', executionResult.data?.resultData?.runData);
  return executionResult;
}
```

---

## 六、DSH 大模型网关与环境变量配置

n8n 节点与 DSH 统一接口保持一致：
- **OpenAI 兼容网关地址**：`http://127.0.0.1:3000/v1` (或读取环境变量 `$env.OPENAI_API_BASE`)
- **常用推荐模型**：`deepseek-chat` (DeepSeek-V3), `gemini-3.7-flash-high`
- **Code 节点环境变量读取**：
  ```javascript
  const apiKey = $env['OPENAI_API_KEY'];
  const baseUrl = $env['OPENAI_API_BASE'] || 'http://127.0.0.1:3000/v1';
  ```
