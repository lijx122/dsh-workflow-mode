# dsh-workflow-mode

> **DeepSeek Harness 工作流模式（Workflow Studio / n8n Pure Zero-Auth Engine）**

[![License](https://img.shields.io/badge/license-MIT%20%2F%20Sustainable%20Use%20License-blue.svg)](./LICENSE)

---

## 🌟 一句话定位（半成品，没进行深度适配）

集成了 **深度修建版 n8n 纯净工作流引擎** 的 DSH 插件：
- **Zero-Auth 零鉴权**：本地自动以最高权限 Owner 身份运行，彻底剥离多余账号注册与登录跳转；
- **DSH 网关原生直连**：自动读取 `~/.dsh/settings.yaml` 与 `~/.dsh/.credentials.yaml`，免凭证零配置直接调用大模型（包含 Claude、Gemini、Grok、DeepSeek 全量模型）；
- **全量深度汉化**：界面与右侧节点抽屉、参数设置（NDV）全中文汉化；
- **DSH Agent 智能操作契约**：插件安装时自动注册 `n8n-workflow` 技能，支持 Agent 一句话通过免密 API 全自动创建、编排、更新与执行工作流。

---

## 🚀 核心功能与亮点

1. **纯净画板 & 零登录阻扰**：
   - 打开即直达工作流画布（`/workflow/new`），彻底剥离了商业推广、遥测追踪、企业多租户菜单。
2. **DSH 大模型 (DSH Chat Model) 归一化**：
   - 拖入 AI Agent 连接大模型节点无需配置任何凭证；
   - 自动复用本地 DSH 环境与网关配置（`http://127.0.0.1:3000/v1`），支持流式生成、思维链（Reasoning）与 Tool Calling。
3. **Agent 自愈与编排规范**：
   - 插件内置 `skills/n8n-workflow/SKILL.md`，安装后自动安装至 `~/.dsh/skills/n8n-workflow`；
   - Agent 可直接调用本地免密 REST API：
     - `GET /rest/workflows`（查询列表）
     - `POST /rest/workflows`（创建工作流）
     - `POST /rest/workflows/:id/run`（执行并轮询获取结果）

---

## 📦 插件结构

```
dsh-workflow-mode/
├─ skills/
│  └─ n8n-workflow/           # 自动分发到 ~/.dsh/skills 的标准 Agent 技能契约
├─ packages/
│  ├─ client-ui-workflow/     # DSH Web GUI 侧边栏与嵌入式工作台插件
│  ├─ workflow-controller/    # 插件后端控制器（包含自动安装 Skill 逻辑）
│  ├─ engine/                 # 工作流执行器
│  └─ schema/                 # 数据模型与校验层
├─ README.md                  # 插件使用文档
├─ README_DSH_AGENT.md        # 面向 Agent 的免密 API 契约速查
└─ LICENSE                    # 开源许可协议 (MIT / Sustainable Use)
```

---

## 🔧 安装与使用

### 1. 安装方式（ShieldCell / DSH 插件市场）
在 DSH 插件市场中搜索 **`dsh-workflow-mode`** 或通过聚合包一键安装。
安装后插件将自动注册侧边栏入口 **「工作流 Studio」**，并自动下发 `n8n-workflow` 技能。

### 2. 独立/开发启动
```bash
# 进入构建目录一键启动
.\start.cmd
```
浏览器打开 `http://localhost:8080` 即可开始绘制工作流。

---

## 📄 开源许可说明 (License)

本项目核心插件框架与 DSH 桥接部分遵循 **MIT License**。
内嵌/修建的 n8n 工作流引擎遵循 **Fair-code (Sustainable Use License)** 协议，允许个人与团队自由进行内部集成与自托管使用。
