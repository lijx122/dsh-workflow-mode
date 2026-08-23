# 工作流工作台（Workflow Studio）整体设计文档

> 版本：v2.1（含 §10 对抗性审查裁决）· 状态：M1 实施中 · 设计基准：`docs/design/workflow-studio-mockup.html`（已定稿，含双主题切换）
> 本文档是工作流工作台的**唯一实现依据**。后续所有开发子 agent 以本文档为准；与旧文档（ARCHITECTURE.md / IMPLEMENTATION_PLAN.md 中 UI 部分）冲突时，以本文档为准。

---

## 1. 背景与定位

DSH 的「工作流模式」Agent 预设只改变 Agent Plane（提示词与工具集），会话界面始终是对话框。要让用户获得 Dify / Coze / n8n 式的**可视化 DAG 编辑与执行体验**，必须由 Web Client 插件提供独立工作台。

产品决策：
- **不嵌入 n8n**（Sustainable Use License 禁止嵌入式分发；Vue 技术栈不兼容 DSH lazy-CJS React 插件体系）。
- 按 Dify 的信息架构 + Apple 2026 Liquid Glass × DSH 官方令牌的视觉语言**原生实现**。
- AI 类节点的执行**全部借道真实 DSH 会话**（session.prompt 路径），自动继承模型配置、凭证、沙箱与文件权限——禁止插件直连模型 API。

---

## 2. 总体架构

### 2.1 三栏布局（核心结构）

```
┌──────────────┬──────────────────────────────────┬─────────────────┐
│ DSH 原版侧边栏 │  中部画布区（本插件）               │ 右侧属性面板       │
│ （宿主，不动） │  默认宽 = 激活时原会话列宽 × 2      │ 420px            │
│              │  ★ 可拖拽分隔条调节，localStorage 记忆│ min 380 max 600 │
└──────────────┴──────────────────────────────────┴─────────────────┘
        ↑ 不渲染、不模拟                ←6px 玻璃分隔条→
```

- **左侧**：DSH 宿主原生会话列表。插件不做任何修改。
- **中部**：画布区。激活时读取原 centerCol 的 `getBoundingClientRect().width`，乘 2 作为初始 flex-basis（夹紧 min 480px / max 可视区 70%）。拖拽分隔条实时更新 CSS 变量并持久化到 `localStorage["dsh.workflowStudio.layout"]`。
- **右侧**：属性面板（检查器）。作为 centerCol 父容器的**追加兄弟节点**插入（不是塞进 centerCol 内部——那是任务看板整屏接管的做法，此处不用）。

### 2.2 预设门控（PresetGate）

已验证：DSH 客户端运行时暴露 `sessions.noteAgentPreset` 与 `sessions.list`（dsh-client-ui-agent-preset 官方插件即用此二者）。

行为规格：
1. 插件 boot 后订阅 `sessions.list`，取当前活动会话的 agentPreset 字段。
2. 仅当当前会话预设 === `workflow` 时：挂载侧边栏「工作流工作台」入口 + 自动弹出右侧面板（带 320ms Apple 曲线入场动画）。
3. 切换到非 workflow 预设会话或新建标准会话：面板自动收起、入口隐藏。
4. 手动点 ✕ 关闭后，同一会话内不再自动弹出（会话级 dismissed 标记）；切换会话重置。

### 2.3 插件契约（沿用已验证结论）

| 项 | 规格 |
|---|---|
| 加载格式 | tsdown 打包为 lazy-CJS：banner `window.__ModuleLoader__.load({id, factory})`，footer `return module.exports;` |
| 宿主半边 | exports["."] = 纯 Cordis apply(){}，不访问任何未 inject 的 ctx 属性 |
| 浏览器半边 | exports["./client"]，package.json `dsh.client = { platform: "web", inject: [] }` |
| 外部依赖 | react / react-dom / @xyflow/react 全部内联打包；CSS 经 lightningcss 转 `<style data-plugin="...">` 注入标签 |
| 幂等守卫 | apply() 模块级 claim（对齐 task-board 的 apply-guard 模式），防止工厂重复执行导致双实例 |
| 失败策略 | DOM 挂载失败仅 console.error，绝不 throw——外部插件不得拖垮 GUI 启动 |

---

## 3. 视觉系统（已定稿，照抄勿改）

### 3.1 双主题机制

机制与 DSH 官方主题插件完全一致：浅色变量写在默认层，深色整体覆盖在 `body[data-ds-dark-theme] {}`。真实实现时**不自己维护开关**，跟随宿主主题属性自动切换。

### 3.2 官方令牌对照表（来源：dsh-client-ui-theme，逐字采用）

| Token | 浅色 (body 默认) | 深色 (body[data-ds-dark-theme]) | 用途 |
|---|---|---|---|
| --dsw-alias-bg-base | #ffffff | #151517 | 全局底色 |
| --dsw-alias-bg-layer-1 | #ffffff | #232324 | 一级面板 |
| --dsw-alias-bg-layer-2 | #ffffff | #2c2c2e | 二级卡片 / 输入框 |
| --dsw-alias-label-primary | #0f1115 | #f9fafb | 主文字 |
| --dsw-alias-label-secondary | #61666b | #cfd3d6 | 次文字 |
| --dsw-alias-label-tertiary | #81858c | #adb2b8 | 弱文字 |
| --dsw-alias-border-l1 | rgba(0,0,0,.04) | rgba(255,255,255,.06) | 发丝描边 |
| --dsw-alias-border-l2 | rgba(0,0,0,.10) | rgba(255,255,255,.12) | 常规边框 |
| --dsw-alias-state-business-primary | #4176e6 | #679efe | 品牌蓝：主按钮/选中/running/聚焦 |
| --dsw-alias-state-success-primary | #22c55e | #22c55e | completed 态 |
| --dsw-alias-state-error-primary | #dc2626 | #f25a5a | failed 态 |
| --dsw-alias-state-warn-primary | #f59e0b | #f59e0b | 执行中日志/异常态 |
| interactive-bg-hover (派生) | rgba(38,49,72,.06) | rgba(255,255,255,.08) | 悬停叠加/chip 底 |

**禁令**：禁止硬编码黑白灰与任何靛紫色（#6366f1 族已否决）；所有叠加色必须走语义变量。品牌蓝 hover 用 `filter: brightness(1.08)`，不引入自造色值。

### 3.3 玻璃质感（克制版）

- 表面：`backdrop-filter: blur(16px) saturate(140%)`；深色底 `rgba(35,35,36,.78)`，浅色底 `rgba(255,255,255,.78)`
- 描边：1px border-l1/l2；顶部内侧微高光 `box-shadow: 0 1px 0 var(--hover-fill) inset`
- 应用于：工具栏、属性面板、添加节点浮层、缩放胶囊、MiniMap、分隔条

### 3.4 圆角 / 动效 / 图标阶梯

| 项 | 值 |
|---|---|
| 控件（按钮/输入框） | 8px |
| 节点卡片 / 浮层卡片 | 10px |
| 大面板（右侧属性面板） | 14px（左上/左下，贴边侧为 0） |
| 面板出入场 | cubic-bezier(.32,.72,0,1) 320ms |
| hover 反馈 | 180ms；按压 scale(.98) |
| 动效降级 | `@media (prefers-reduced-motion: reduce)` 全部关闭 |
| 图标 | 内联 SVG 或 emoji（emoji 仅示意，实现期统一换 16px stroke SVG） |

### 3.5 节点类型识别色（插件扩展调色板，双主题共用，须在代码注释中声明为扩展）

| 类型 | 色 | 说明 |
|---|---|---|
| start / end | #61666b | 中性端点 |
| llm | var(business-primary) | **随主题取官方值**（浅 #4176e6 / 深 #679efe） |
| subagent | #06b6d4 | 青 |
| if_else / switch | #f59e0b | 琥珀 |
| template | #ec4899 | 粉 |
| code | #8b5cf6 | 紫（唯一点缀） |
| iteration / merge / set_variable 等 | 取最近语义色的中性变体 | 实现期按需补充 |

---

## 4. 节点系统（Dify 调研结论 → 本项目映射）

### 4.1 Dify 调研要点（源码实证，本地 `_research/dify`）

1. 单节点 = 四件套目录：`default.ts`（元数据+默认值+checkValid）/ `types.ts` / `node.tsx`（画布缩略卡）/ `panel.tsx`+use-config（配置面板）。
2. LLM 节点画布卡内嵌**只读 ModelSelector** 显示所选模型；面板里才是可编辑选择器——"选中模型"的正确交互形态。
3. 加节点交互 = block-selector 弹层（点击画布「+」或连线末端「+」→ 分类 Tab 列表 → 点击添加）；**没有 HTML5 palette 拖拽入画布**。画布内移动用 React Flow 原生 nodesDraggable。
4. 节点视觉：240px 固定宽、rounded-[15px]（本项目取 10px 对齐 DSH 圆角阶梯）、透明边框 + 状态描边（running 蓝/success 绿/failed 红/exception 黄）、hover shadow-lg。
5. 配置面板最小 400px，ResizeObserver 自适应防挤压画布。

### 4.2 节点类型映射表（dsh.workflow.v1）

| 分组 | 节点类型 | 卡片要素 | 属性面板关键字段 | 执行策略（§5） |
|---|---|---|---|---|
| 逻辑控制 | start | 🏁 输入参数表 | 参数名/类型/默认值 | 本地：注入初始变量 |
| | end | 🛑 输出映射 | 变量←引用选择 | 本地：收集终值 |
| | if_else | 🔀 条件表达式 | expr 编辑（expr-eval 方言） | 本地：表达式求值 |
| | switch | 🔀 多路 case | case 列表 | 本地 |
| | merge / set_variable | 合并/赋值 | 变量映射 | 本地 |
| | iteration | ♾ 循环体容器 | over 数组引用 + body 子图 | 本地循环调度 |
| AI 能力 | **llm** | 🤖 模型名小字 | **模型下拉(DSH 模型列表)** / system+user 提示词 / temperature / 输出 JSON Schema | **会话驱动** |
| | **subagent** | 🧠 agent 标识 | **工作区选择器(含子 Agent 文件夹)** / 预设选择 / 任务 prompt | **会话驱动** |
| | human | 👤 断点说明 | 审批提示文案 / 超时策略 | 断点暂停 |
| 转换处理 | template | 📝 模板摘要 | Jinja-like 模板文本 | 本地渲染 |
| | code | 💻 语言徽标 | JS 代码编辑器 | 受限沙箱执行 |
| | http_request | 🌐 方法+URL | method/url/headers/body | fetch 执行 |

每个节点在 `packages/client-ui-workflow/src/nodes/<type>/` 下实现四件套，注册进统一的 NODE_REGISTRY（id、label、色 token、默认值工厂、checkValid、PanelComponent、CardComponent）。

### 4.3 节点四态（画布呈现规范）

| 状态 | 视觉 |
|---|---|
| pending | opacity .68、无描边 |
| running | 品牌蓝 2px 描边 + 呼吸脉冲光圈动画 |
| completed | 绿描边 |
| failed | 红描边 |

连线：默认虚线弱色；active 边品牌蓝加粗；分支边挂 true/false 徽章（success/warn tint 底）。

---

## 5. 执行编排器（RunOrchestrator）

### 5.1 执行路径分流

```
Run 按钮
  └─ Orchestrator 拓扑排序遍历 DAG
       ├─ 纯逻辑节点（start/end/if_else/switch/merge/set_variable/template/iteration）
       │    → 浏览器内确定性执行（与 packages/engine 同语义），零延迟回填状态
       ├─ llm 节点
       │    → sessions.create/open 临时运行会话（standard 预设）
       │      · 若节点选了模型：经模型设置接口写入该会话
       │      · session.prompt(system+user 渲染后的完整 prompt)
       │      · 流式增量回填节点输出
       ├─ subagent 节点
       │    → sessions.create 绑定所选工作区（子 Agent 文件夹）+ 所选预设
       │      · prompt 投递 → 等待 turn 结束 → 回收最终输出
       └─ human 节点
            → run 进入 paused，弹审批卡；批准/驳回后继续/终止
```

### 5.2 运行数据流

- 每次运行生成 runId，节点状态机：pending → running(completed|failed|skipped)，实时写入画布（复用现有 nodeStates 管道）。
- 失败处理遵循 DSL 的 onError（stop/continue/route）；skipped 因死路消除传播。
- 运行日志条目（时间戳+消息）滚动展示于底部日志栏，最近一条常显。
- 右侧面板「运行输出」块显示该节点最后一次 outputs JSON。

### 5.3 明确的非目标（本期）

- 不做并行分支并发调度（顺序执行拓扑序，fork-join 视觉保留、执行串行）——登记 TECH_DEBT。
- 不做服务端引擎联动（/opt 引擎与 run.json 持久化仍供 Agent 预设使用，与 Studio 执行互不影响）。

---

## 6. 工作流库与持久化

| 项 | 规格 |
|---|---|
| 存储键 | `localStorage["dsh.workflowStudio.v1"]` |
| 数据形状 | `{ workflows: [{ id, name, dsl, updatedAt }], activeId }` |
| 操作 | 新建（空白 start→end 模板）/ 重命名 / 复制 / 删除 / 另存 |
| 导入导出 | .json 文件（与 dsh.workflow.v1 同构，可直接被引擎热加载目录消费） |
| 布局记忆 | `localStorage["dsh.workflowStudio.layout"]`: { centerBasis, panelWidth } |

工具栏控件从左至右：标题+模式徽章 → 工作流下拉（当前库名单）→ ➕添加节点▾ → 📋JSON DSL → ▶运行工作流（主按钮）→ ☀️/🌙（跟随宿主，mockup 中的手动按钮仅为演示）→ ✕关闭。

---

## 7. 文件结构规划

```
packages/client-ui-workflow/
├─ tsdown.config.ts                  # 不变（lazy-CJS + CSS 内联）
├─ cordis.patch.yml                  # 不变
└─ src/
   ├─ client.ts                      # apply: 幂等守卫 + PresetGate 装配
   ├─ preset-gate.ts                 # ★ M1: sessions.list 订阅 → 门控信号 store
   ├─ studio-mount.tsx               # ★ M1 重写: 兄弟节点注入 + 分隔条 + 尺寸记忆
   ├─ sidebar-entry.ts               # 入口按钮（受门控控制可见性）
   ├─ theme.ts                       # ★ 跟随宿主主题（读 data-ds-dark-theme 属性变化）
   ├─ studio/
   │  ├─ WorkflowStudio.tsx          # 三区容器：工具栏/画布/底部日志
   │  ├─ toolbar.tsx  canvas.tsx  inspector.tsx  log-bar.tsx
   │  └─ block-selector.tsx          # 添加节点分类浮层
   ├─ nodes/                         # ★ M2: 每类节点四件套
   │  ├─ registry.ts
   │  └─ <type>/{default,types,card,panel}.ts(x)
   ├─ run/
   │  ├─ orchestrator.ts             # ★ M3: 拓扑调度 + 状态机
   │  ├─ local-executors.ts          # 纯逻辑节点
   │  └─ session-executor.ts         # llm/subagent 会话驱动
   ├─ library.ts                     # ★ M4: 工作流库 CRUD + 导入导出
   └─ styles/
      ├─ tokens.css                  # §3.2 双主题令牌（照抄 mockup :root/body 两层）
      └─ studio.module.css           # 组件样式（lightningcss 处理）
```

---

## 8. 里程碑与验收标准

### M1 布局重构 + 门控 + 生命周期修复（先行）
- [ ] 三栏结构落地：中=原列×2 可拖、右=兄弟面板、左=宿主不动
- [ ] PresetGate：非 workflow 预设无入口无面板；选中自动弹出
- [ ] apply 幂等守卫；✕ 关闭彻底（根因：双实例互相覆盖激活态）
- [ ] 主题跟随宿主 data-ds-dark-theme
- **验收**：浏览器实测四种切换组合（workflow↔standard 会话切换、手动关开、刷新恢复布局、双主题）

### M2 节点系统界面化
- [ ] NODE_REGISTRY + 分类 block-selector 浮层
- [ ] 各节点差异化卡片（§3.5 色 + §4.3 四态）+ 属性面板（llm 含模型下拉读 DSH 模型列表）
- **验收**：六类节点外观互异；LLM 面板能列出并选定宿主已配模型

### M3 执行真实化
- [ ] Orchestrator + 本地执行器 + 会话执行器 + human 断点
- **验收**：示例工作流运行，llm 节点返回真实模型输出；subagent 在指定工作区产生可查文件痕迹；断点暂停恢复正确

### M4 工作流库
- [ ] CRUD + 导入导出 + 运行历史（内存即可）
- **验收**：新建→编辑→保存→刷新恢复→导出再导入一致

每阶段完成即部署 shieldcell 并在 https://nextchat.shieldcell.cn/ 浏览器实测后交付。

---

## 9. 关联文档与既有资产

- 设计基准图：`docs/design/workflow-studio-mockup.html`（双主题可切换，规格标注在其页尾 details 区）
- DSL 规范与引擎：`ARCHITECTURE.md` / `packages/schema` / `packages/engine`（21 种执行器，服务端预设链路继续有效）
- 交互先例：任务看板插件（sidebar-entry 自愈注入、apply-guard、settingsScope 模式均可直接借鉴）
- 技术债登记：`TECH_DEBT.md`（新增：Studio 并行调度缺失 D-?；会话驱动延迟高于原生引擎 D-?）


---

## 10. 对抗性审查裁决（v2.1 修订记录 · 绑定效力高于前文冲突处）

> 首轮对抗评审结论 REVISE（19 项）。以下裁决为最终规范；正文与之冲突处以本节为准。

### P0 裁决
1. **模型接口**：客户端 contract 无任何模型读写 API（实证 grep 为空）。M2 LLM 面板的「模型下拉」改为：实现期探测 `dsh-client-ui-model-selection` 数据源，探得则用；**探不得则降级为只读展示会话当前模型 + 仅提示词可编辑**，两种结局都算验收通过。M3「经模型设置接口写入会话」条款作废。降级结局登记 TECH_DEBT。
2. **临时会话与门控共存**：编排器创建的运行会话登记进模块级 exemptSessionIds 集合；PresetGate 计算活动预设时跳过豁免集合；运行会话禁止占用宿主 blank 复用位（显式指定 workspace/preset 创建）。
3. **http_request 节点移出本期范围**（浏览器 CORS 无解、宿主中继无证据）。§4.2 的执行承诺作废，仅保留 DSL 兼容；登记 TECH_DEBT 待宿主代理方案。
4. **注入自愈**：右面板与分隔条采用 board-mount 同款机制——容器挂 centerCol 内部尾部（修正 §2.1「兄弟插入」），对话隐藏用 `html[data-dsh-workflow-active]` 属性级 CSS 规则（含 :not 排他守卫，防与 task-board/ssh 面板互殴）；MutationObserver 双层自愈（body 级等待 + 根级复位）；卸载还原属性并移除容器。

### P1 裁决
5. 中栏初始宽度改为 `max(480px, min(原列×2, 可视区宽−420−6−320))`——保证右面板完整可见且画布有余量，废除无条件 ×2。
6. 统一钳制值：面板 380–600px；画布视口最小 480px。mockup 的 720/640 作废。
7. 节点卡片统一 240px 宽、高自适应；layout.ts 按实测尺寸布线、handle 动态计算，废除 200×90 与钉死 y=90/x=96 常量。
8. 全量状态枚举（DSL↔UI 映射）：pending / running / completed / failed / skipped / waiting_human；waiting_human = 品牌蓝虚线描边+👤角标；skipped = opacity .4+灰描边。现有 success 字样一律迁移为 completed。
9. 幂等守卫成对实现：claim 成功后 ctx.effect(() => release) 注册卸载释放。
10. 布局记忆键升级 dsh.workflowStudio.layout.v2；读取后按当前视口重 clamp 再应用；写入 try/catch 静默降级。
11. 工作流库读失败策略：try/catch → 坏值备份 .bak 键 → 空库启动 + UI 提示；跨页签同步本期不做。
12. 迁移清单：node-card.tsx / edge-branch.tsx / canvas.tsx 由 M2 nodes/<type>/ 四件套替代并删除；templates.ts 并入 library 默认工作流；WorkflowStudio.tsx 由 studio/ 目录替代；index.ts / cordis-plugin.ts 保留。M2 完成时旧文件必须不存在。
13. 弃用 React Flow 原生 Controls/MiniMap，缩放胶囊与 MiniMap 卡按 mockup 自绘；@xyflow 默认样式用 --xy-* 变量覆盖至主题化，禁止直引 style.css 后的默认视觉残留。
14. client.ts 声明 inject = [''sessions'']（PresetGate 需要），apply(ctx) 对齐；宿主半边保持无行为。
15. 生产 CSS 禁用 color-mix()：一律使用 mockup 已预计算的 --tint-* 与显式 rgba 值（lightningcss 不转译）。
16. iteration 执行语义：平面拓扑串行不变；iteration 节点对 body 子图做内联子队列循环（每次迭代串行跑完 body），整体计单节点完成态。code 节点沙箱：new Function + 冻结白名单全局（console/Math/JSON/输入变量），禁 network/dom；Worker 方案登记 TECH_DEBT。

### P2 裁决
17. 底部日志栏执行态色统一品牌蓝（与节点 running 一致）；warn 琥珀仅用于异常/重试文案。
18. agentPreset 为可选字段：undefined/缺席一律按非 workflow 处理；证据以 runtime 类型为准。
19. dismissed 标记存内存（刷新即允许再次自动弹出）；运行中切走会话 → 编排器继续跑完但面板收起，返回且 run 未结束则恢复显示；显式 ✕ 关闭 = 不再派发新节点，已发出的 prompt 等待自然返回。
20. M2 验收改逐类型清单：12 个 DSL 类型逐一核对色条/图标/徽章/副标题/面板字段五要素，全过才算过。
21. human 断点优先探测宿主 pendingInteraction 能力，不可用再落回本地 paused 态（两态均映射 waiting_human 视觉）。

