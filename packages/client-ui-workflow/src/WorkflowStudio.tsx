import React, { useState, useCallback, useMemo } from "react";
import { WorkflowCanvas } from "./canvas.js";
import { SAMPLE_WORKFLOWS } from "./templates.js";
import type { WorkflowDSL, WorkflowNode, NodeStateInfo } from "./types.js";
import css from "./workflow-studio.module.css";

export interface WorkflowStudioProps {
  onClose?: () => void;
}

export const WorkflowStudio: React.FC<WorkflowStudioProps> = ({ onClose }) => {
  const [templateKey, setTemplateKey] = useState<string>("triage");
  const [dsl, setDsl] = useState<WorkflowDSL>(SAMPLE_WORKFLOWS.triage);
  const [rawJson, setRawJson] = useState<string>(() => JSON.stringify(SAMPLE_WORKFLOWS.triage, null, 2));
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>("intent_llm");
  const [viewMode, setViewMode] = useState<"canvas" | "json">("canvas");
  const [nodeStates, setNodeStates] = useState<Record<string, NodeStateInfo>>({});
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [logs, setLogs] = useState<Array<{ time: string; message: string }>>([
    { time: new Date().toLocaleTimeString(), message: "工作流工作台已就绪。点击【⚡ 运行工作流】开始执行 DAG。" }
  ]);

  const addLog = useCallback((message: string) => {
    setLogs((prev) => [...prev.slice(-49), { time: new Date().toLocaleTimeString(), message }]);
  }, []);

  const handleSelectTemplate = useCallback((key: string) => {
    const tpl = SAMPLE_WORKFLOWS[key];
    if (tpl) {
      setTemplateKey(key);
      setDsl(tpl);
      setRawJson(JSON.stringify(tpl, null, 2));
      setSelectedNodeId(tpl.nodes[0]?.id || null);
      setNodeStates({});
      addLog(`已载入模版：${tpl.name}`);
    }
  }, [addLog]);

  const selectedNode = useMemo(() => {
    return dsl.nodes.find((n) => n.id === selectedNodeId) || null;
  }, [dsl.nodes, selectedNodeId]);

  // 1. 运行工作流 (Run Full Workflow DAG)
  const handleRunWorkflow = useCallback(async () => {
    if (isRunning) return;
    setIsRunning(true);
    addLog("=== 开始执行工作流 DAG 调度 ===");

    const initialStates: Record<string, NodeStateInfo> = {};
    for (const node of dsl.nodes) {
      initialStates[node.id] = { status: "pending" };
    }
    setNodeStates(initialStates);

    for (const node of dsl.nodes) {
      setNodeStates((prev) => ({
        ...prev,
        [node.id]: { status: "running" },
      }));
      addLog(`节点 [${node.name || node.id} (${node.type})] 开始执行...`);

      await new Promise((r) => setTimeout(r, 600));

      const mockOutput: Record<string, any> = {
        executedAt: new Date().toISOString(),
        nodeType: node.type,
      };

      if (node.type === "start") {
        mockOutput.payload = node.inputs || {};
      } else if (node.type === "llm") {
        mockOutput.text = `[LLM 分析完成] 意图判定为 incident，严重度 high，推荐即时排查`;
      } else if (node.type === "if_else") {
        mockOutput.branch = "true";
      } else if (node.type === "code") {
        mockOutput.result = { processed: true, count: 2 };
      } else if (node.type === "subagent") {
        mockOutput.result = `[子 Agent 专职执行] 诊断完成，已输出修复补丁方案`;
      } else {
        mockOutput.status = "ok";
      }

      setNodeStates((prev) => ({
        ...prev,
        [node.id]: {
          status: "completed",
          outputs: mockOutput,
          durationMs: 580,
        },
      }));
      addLog(`节点 [${node.name || node.id}] 执行完毕 ✓`);
    }

    addLog("=== 工作流全链路执行成功 (All Nodes Completed) ===");
    setIsRunning(false);
  }, [dsl.nodes, isRunning, addLog]);

  // 2. 单节点试跑 (Dry Run Single Node)
  const handleDryRunNode = useCallback(async (nodeId: string) => {
    const node = dsl.nodes.find((n) => n.id === nodeId);
    if (!node) return;

    addLog(`试跑单节点 [${node.name || node.id}]...`);
    setNodeStates((prev) => ({
      ...prev,
      [nodeId]: { status: "running" },
    }));

    await new Promise((r) => setTimeout(r, 450));

    const mockOutput = {
      dryRun: true,
      testedAt: new Date().toLocaleTimeString(),
      nodeType: node.type,
      result: `[${node.type} 试跑成功] 模拟输出数据正常`,
    };

    setNodeStates((prev) => ({
      ...prev,
      [nodeId]: {
        status: "completed",
        outputs: mockOutput,
        durationMs: 450,
      },
    }));
    addLog(`单节点 [${node.name || node.id}] 试跑成功 ✓`);
  }, [dsl.nodes, addLog]);

  // 3. JSON DSL 同步
  const handleJsonChange = useCallback((text: string) => {
    setRawJson(text);
    try {
      const parsed = JSON.parse(text);
      if (parsed.nodes && parsed.edges) {
        setDsl(parsed);
      }
    } catch {}
  }, []);

  // 4. 添加节点
  const handleAddNode = useCallback((type: WorkflowNode["type"]) => {
    const id = `${type}_${Date.now().toString(36).slice(-4)}`;
    let newNode: WorkflowNode;

    switch (type) {
      case "start":
        newNode = { id, type: "start", name: "输入节点", inputs: { query: { type: "string", default: "" } } };
        break;
      case "end":
        newNode = { id, type: "end", name: "结束节点", outputs: { result: "" } };
        break;
      case "if_else":
        newNode = { id, type: "if_else", name: "条件分支", condition: "value > 0" };
        break;
      case "code":
        newNode = { id, type: "code", name: "Code 脚本", code: "return { success: true };" };
        break;
      case "subagent":
        newNode = { id, type: "subagent", name: "子 Agent 节点", prompt: "请执行指定任务" };
        break;
      case "template":
        newNode = { id, type: "template", name: "模版渲染", template: "渲染模版文本" };
        break;
      case "llm":
      default:
        newNode = { id, type: "llm", name: "LLM 节点", prompt: "请分析输入内容" };
        break;
    }

    const updated = {
      ...dsl,
      nodes: [...dsl.nodes, newNode as any],
    };
    setDsl(updated as WorkflowDSL);
    setRawJson(JSON.stringify(updated, null, 2));
    setSelectedNodeId(id);
    addLog(`已添加节点：${newNode.name} (${id})`);
  }, [dsl, addLog]);

  return (
    <div className={css.studio}>
      {/* 顶部工具栏 */}
      <div className={css.toolbar}>
        <div className={css.toolGroup}>
          <div className={css.titleArea}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ stroke: 'var(--dsw-alias-state-business-primary, #4176e6)' }} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="18" r="3"></circle>
              <circle cx="6" cy="6" r="3"></circle>
              <path d="M13 6h3a2 2 0 0 1 2 2v7"></path>
              <line x1="6" y1="9" x2="6" y2="21"></line>
            </svg>
            <h2 className={css.title}>工作流工作台</h2>
            <span className={css.badge}>Dify/Coze 模式</span>
          </div>

          <select
            className={css.select}
            value={templateKey}
            onChange={(e) => handleSelectTemplate(e.target.value)}
          >
            <option value="triage">📋 模版：智能工单分流与解答</option>
            <option value="summarizer">📚 模版：多智能体文献精读提炼</option>
            <option value="code_review">🛡️ 模版：代码安全审计与自动修复</option>
          </select>
        </div>

        <div className={css.toolGroup}>
          <button
            className={css.btnPrimary}
            onClick={handleRunWorkflow}
            disabled={isRunning}
          >
            {isRunning ? "⏳ 调度执行中..." : "⚡ 运行工作流"}
          </button>

          <button
            className={css.btnSecondary}
            onClick={() => setViewMode(viewMode === "canvas" ? "json" : "canvas")}
          >
            {viewMode === "canvas" ? "📋 切换 JSON DSL" : "🎨 切换可视画布"}
          </button>

          <select
            className={css.select}
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) {
                handleAddNode(e.target.value as any);
                e.target.value = "";
              }
            }}
          >
            <option value="" disabled>➕ 添加节点...</option>
            <option value="llm">🤖 LLM 认知节点</option>
            <option value="subagent">👥 子 Agent 协作</option>
            <option value="if_else">🔀 If / Else 条件分支</option>
            <option value="code">💻 Code 脚本节点</option>
            <option value="template">📝 模版渲染节点</option>
          </select>

          {onClose && (
            <button className={css.btnSecondary} onClick={onClose} title="返回对话界面">
              ✕ 关闭工作台
            </button>
          )}
        </div>
      </div>

      {/* 主视图区域 */}
      <div className={css.mainArea}>
        {viewMode === "canvas" ? (
          <>
            <div className={css.canvasContainer}>
              <WorkflowCanvas
                dsl={dsl}
                nodeStates={nodeStates}
                onNodeClick={(_evt, node) => setSelectedNodeId(node.id)}
              />
            </div>

            {/* 节点配置与调试抽屉 */}
            {selectedNode && (
              <div className={css.inspector}>
                <div className={css.inspectorHeader}>
                  <h3 className={css.inspectorTitle}>
                    <span>🔧 节点属性配置</span>
                  </h3>
                  <span className={css.badge}>{selectedNode.type}</span>
                </div>

                <div className={css.inspectorContent}>
                  <div className={css.fieldGroup}>
                    <label className={css.fieldLabel}>节点 ID</label>
                    <input className={css.input} value={selectedNode.id} readOnly />
                  </div>

                  <div className={css.fieldGroup}>
                    <label className={css.fieldLabel}>节点名称</label>
                    <input
                      className={css.input}
                      value={selectedNode.name || ""}
                      onChange={(e) => {
                        const updated = {
                          ...dsl,
                          nodes: dsl.nodes.map((n) =>
                            n.id === selectedNode.id ? { ...n, name: e.target.value } : n
                          ),
                        };
                        setDsl(updated as WorkflowDSL);
                        setRawJson(JSON.stringify(updated, null, 2));
                      }}
                    />
                  </div>

                  <div className={css.fieldGroup}>
                    <label className={css.fieldLabel}>节点定义数据 (Configuration)</label>
                    <div className={css.jsonBox}>
                      {JSON.stringify(selectedNode, null, 2)}
                    </div>
                  </div>

                  <div className={css.fieldGroup}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <label className={css.fieldLabel}>节点运行状态 / 产出</label>
                      <button
                        className={css.btnSecondary}
                        style={{ fontSize: "11px", padding: "2px 8px" }}
                        onClick={() => handleDryRunNode(selectedNode.id)}
                      >
                        🔍 试跑单节点
                      </button>
                    </div>
                    <div className={css.jsonBox}>
                      {JSON.stringify(nodeStates[selectedNode.id] || { status: "pending", outputs: null }, null, 2)}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className={css.jsonEditorView}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className={css.fieldLabel}>工作流 DSL 定义 (dsh.workflow.v1)</span>
              <span className={css.badge}>{dsl.nodes.length} 个节点, {dsl.edges.length} 条边</span>
            </div>
            <textarea
              className={css.jsonTextarea}
              value={rawJson}
              onChange={(e) => handleJsonChange(e.target.value)}
            />
          </div>
        )}
      </div>

      {/* 底部执行状态日志栏 */}
      <div className={css.logBar}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", overflow: "hidden" }}>
          <span>状态日志:</span>
          <span style={{ color: "#94a3b8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {logs[logs.length - 1]?.time} - {logs[logs.length - 1]?.message}
          </span>
        </div>
        <div>
          {isRunning ? (
            <span className={css.statusRunning}>● 执行中...</span>
          ) : (
            <span className={css.statusSuccess}>● 引擎就绪</span>
          )}
        </div>
      </div>
    </div>
  );
};
