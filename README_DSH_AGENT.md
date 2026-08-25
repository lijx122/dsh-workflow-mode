# n8n 纯净版 Agent 免密 API (Zero-Auth) 契约与操作手册

> **定位**：本文档专为 DSH Agent 与自动化脚本编写，提供当前纯净版 n8n 的**零鉴权（Zero-Auth）REST 接口规范**与**工作流自动化调度指南**，让 Agent 能以最小的上下文成本完成全自动工作流编排、部署、执行与结果收集。

---

## 1. 架构与免密机制 (Zero-Auth)

- **服务基础地址**：`http://127.0.0.1:5678`（本地默认端口）
- **免密原理**：后端已集成 Zero-Auth 中间件。凡是本地发起的 `/rest/*` 请求，系统均会自动以 **Instance Owner** 权限上下文注入执行，无需配置任何 Authorization Header、API Key 或 Cookie。
- **请求格式**：统一使用 `Content-Type: application/json`。

---

## 2. 核心 REST API 契约

### 2.1 工作流管理 (Workflows CRUD)

#### ① 获取所有工作流列表
- **Endpoint**: `GET /rest/workflows`
- **Query 参数 (可选)**:
  - `limit`: 返回数量上限（如 `20`）
  - `filter`: 过滤条件 JSON
- **响应示例**:
  ```json
  {
    "count": 1,
    "data": [
      {
        "id": "wf_123456",
        "name": "定时数据分析",
        "active": false,
        "createdAt": "2025-01-01T00:00:00.000Z",
        "updatedAt": "2025-01-01T00:00:00.000Z"
      }
    ]
  }
  ```

#### ② 获取单个工作流详情
- **Endpoint**: `GET /rest/workflows/:id`
- **响应内容**: 返回包含完整 `nodes`、`connections`、`settings`、`pinData` 和 `checksum` 的工作流对象。

#### ③ 创建新工作流
- **Endpoint**: `POST /rest/workflows`
- **Request Body**:
  ```json
  {
    "name": "工作流名称",
    "nodes": [
      {
        "id": "11111111-1111-4111-8111-111111111111",
        "name": "When clicking ‘Test workflow’",
        "type": "n8n-nodes-base.manualTrigger",
        "typeVersion": 1,
        "position": [240, 300],
        "parameters": {}
      },
      {
        "id": "22222222-2222-4222-8222-222222222222",
        "name": "Code Handler",
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": [500, 300],
        "parameters": {
          "jsCode": "return [{ json: { status: 'success', timestamp: Date.now() } }];"
        }
      }
    ],
    "connections": {
      "When clicking ‘Test workflow’": {
        "main": [
          [
            { "node": "Code Handler", "type": "main", "index": 0 }
          ]
        ]
      }
    },
    "settings": {
      "executionOrder": "v1"
    }
  }
  ```
- **响应示例**: 返回包含新生成 `id` 的完整工作流对象。

#### ④ 更新工作流
- **Endpoint**: `PATCH /rest/workflows/:id`
- **Request Body**: 传入需要修改的字段（如 `name`, `nodes`, `connections`, `settings`）。
- **说明**: 建议通过 `GET /rest/workflows/:id` 获取现有定义后，修改对应节点或连线并执行 PATCH。

#### ⑤ 删除工作流
- **Endpoint**: `DELETE /rest/workflows/:id`
- **响应**: `true` (200 OK)

#### ⑥ 激活 / 停用工作流 (用于生产定时任务/Webhook)
- **激活**: `POST /rest/workflows/:id/activate`，Body: `{}`
- **停用**: `POST /rest/workflows/:id/deactivate`，Body: `{}`

---

### 2.2 工作流执行与结果获取 (Execution Lifecycle)

#### ① 手动触发执行工作流
- **Endpoint**: `POST /rest/workflows/:id/run`
- **模式 A：指定起始触发器 (推荐)**
  ```json
  {
    "triggerToStartFrom": {
      "name": "When clicking ‘Test workflow’"
    }
  }
  ```
- **模式 B：指定终点节点 (执行至目标节点)**
  ```json
  {
    "destinationNode": {
      "nodeName": "Code Handler",
      "mode": "inclusive"
    }
  }
  ```
- **响应示例**:
  ```json
  {
    "executionId": "42",
    "waitingForWebhook": false
  }
  ```

#### ② 查询 Execution 执行状态与输出数据
- **Endpoint**: `GET /rest/executions/:id`
- **响应关键字段**:
  - `status`: `"running"` | `"finished"` | `"error"` | `"crashed"`
  - `finished`: `true` | `false`
  - `data.resultData.runData`: 各节点运行明细及输出数据字典（以 Node Name 为键）
  - `data.resultData.error`: 失败时的错误堆栈与上下文信息

```json
{
  "id": "42",
  "finished": true,
  "status": "finished",
  "data": {
    "resultData": {
      "runData": {
        "Code Handler": [
          {
            "startTime": 1740000000000,
            "executionTime": 12,
            "data": {
              "main": [
                [
                  {
                    "json": {
                      "status": "success",
                      "timestamp": 1740000000000
                    }
                  }
                ]
              ]
            }
          }
        ]
      }
    }
  }
}
```

#### ③ 终止运行中的执行
- **Endpoint**: `POST /rest/executions/:id/stop`

---

### 2.3 Webhook 触发接口

若工作流配置了 `n8n-nodes-base.webhook` 节点，可直接通过公开 HTTP 触发：
- **正式 Webhook (工作流须处于 Active 状态)**:
  `POST http://127.0.0.1:5678/webhook/<path>`
- **测试 Webhook (无需激活)**:
  `POST http://127.0.0.1:5678/webhook-test/<path>`

---

## 3. 工作流拓扑构建规范 (DAG & AI Connections)

Agent 生成工作流 JSON 时，需遵守以下拓扑与连线约束：

### 3.1 坐标规范 (DAG Layout)
- 起始节点坐标：`[240, 300]`
- 横向主干递增：`X_next = X_curr + 260`, `Y_next = Y_curr`
- AI 附属节点（Model / Tool）挂载在对应 Agent 节点下方：
  - Model: `[Agent.X - 100, Agent.Y + 180]`
  - Tool: `[Agent.X + 100, Agent.Y + 180]`

### 3.2 连线通道分类
1. **`main`**: 普通数据与控制流流转通道。
2. **`ai_languageModel`**: 大语言模型连接至 AI Agent。
3. **`ai_tool`**: Code Tool / Calculator / HTTP Tool 连接至 AI Agent。
4. **`ai_memory`**: 会话记忆组件连接至 AI Agent。

> ⚠️ **注意**：`connections` 中的所有 Key 和 Target Node 名称必须与 `nodes[i].name` 完全一致，区分大小写。

---

## 4. Agent 一键调用脚本示例 (Node.js)

以下脚本展示了 Agent 如何在本地以纯脚本方式实现 **创建工作流 -> 触发执行 -> 轮询并提取最终结果**：

```javascript
/**
 * n8n-runner.mjs
 * 纯免密全自动工作流执行示例
 */
const BASE_URL = 'http://127.0.0.1:5678';

async function executeAgentWorkflow() {
  // 1. 定义工作流
  const workflowDefinition = {
    name: `Agent-Task-${Date.now()}`,
    nodes: [
      {
        id: "d0000001-0000-4000-8000-000000000001",
        name: "Manual Start",
        type: "n8n-nodes-base.manualTrigger",
        typeVersion: 1,
        position: [240, 300],
        parameters: {}
      },
      {
        id: "d0000002-0000-4000-8000-000000000002",
        name: "Execute Computation",
        type: "n8n-nodes-base.code",
        typeVersion: 2,
        position: [500, 300],
        parameters: {
          jsCode: "return [{ json: { processed: true, summary: 'Data ready for next phase' } }];"
        }
      }
    ],
    connections: {
      "Manual Start": {
        "main": [[{ "node": "Execute Computation", "type": "main", "index": 0 }]]
      }
    },
    settings: { "executionOrder": "v1" }
  };

  // 2. 创建工作流
  const createRes = await fetch(`${BASE_URL}/rest/workflows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(workflowDefinition)
  });
  if (!createRes.ok) throw new Error(`Create workflow failed: ${await createRes.text()}`);
  const wf = await createRes.json();
  console.log(`[+] Workflow created: ID=${wf.id}`);

  // 3. 执行工作流
  const runRes = await fetch(`${BASE_URL}/rest/workflows/${wf.id}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      triggerToStartFrom: { name: "Manual Start" }
    })
  });
  if (!runRes.ok) throw new Error(`Run workflow failed: ${await runRes.text()}`);
  const { executionId } = await runRes.json();
  console.log(`[+] Execution triggered: ID=${executionId}`);

  // 4. 轮询获取执行结果
  let execution = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const statusRes = await fetch(`${BASE_URL}/rest/executions/${executionId}`);
    execution = await statusRes.json();
    if (execution.finished) break;
  }

  if (!execution?.finished) {
    throw new Error('Execution timed out or aborted');
  }

  // 5. 提取目标节点的输出数据
  const finalOutput = execution.data.resultData.runData["Execute Computation"]?.[0]?.data?.main?.[0];
  console.log('[+] Final Output:', JSON.stringify(finalOutput, null, 2));
  return finalOutput;
}

executeAgentWorkflow().catch(console.error);
```

---

## 5. DSH 环境变量与 LLM 接入配置

在 n8n Code 节点与模型凭据中，推荐统一遵循以下环境变量映射：

| 环境变量 | 推荐值 | 说明 |
| :--- | :--- | :--- |
| `OPENAI_API_BASE` | `https://web.shieldcell.cn/v1` | OpenAI 兼容网关地址 |
| `OPENAI_API_KEY` | *(用户配置密钥)* | DSH 统一调用密钥 |
| `N8N_HOST` | `127.0.0.1` | 服务绑定地址 |
| `N8N_PORT` | `5678` | 服务监听端口 |

在 Code 节点中直接通过 `$env` 对象安全读取：
```javascript
const baseUrl = $env['OPENAI_API_BASE'] || 'https://web.shieldcell.cn/v1';
const apiKey = $env['OPENAI_API_KEY'];
```
