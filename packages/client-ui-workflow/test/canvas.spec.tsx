import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowCanvas } from "../src/canvas.js";
import { activate } from "../src/client.js";
import { ALL_NODE_TYPES, type WorkflowDSL, type NodeType } from "@dsh-workflow/schema";
import { NODE_TYPE_ICONS, STATUS_STYLES } from "../src/node-card.js";

describe("WorkflowCanvas Component", () => {
  const sample8NodeDSL: WorkflowDSL = {
    version: "dsh.workflow.v1",
    name: "complex-8-node-workflow",
    nodes: [
      { id: "start_node", type: "start" },
      { id: "fetch_data", type: "plugin_tool", toolName: "fetcher" },
      { id: "process_data", type: "code", code: "return data;" },
      { id: "check_condition", type: "if_else", condition: "val > 0" },
      { id: "llm_summary", type: "llm", prompt: "Summarize" },
      { id: "human_review", type: "human", prompt: "Please approve" },
      { id: "subagent_exec", type: "subagent", prompt: "Execute task" },
      { id: "end_node", type: "end" },
    ],
    edges: [
      { id: "e1", source: "start_node", target: "fetch_data" },
      { id: "e2", source: "fetch_data", target: "process_data" },
      { id: "e3", source: "process_data", target: "check_condition" },
      { id: "e4", source: "check_condition", target: "llm_summary", branch: "true" },
      { id: "e5", source: "check_condition", target: "subagent_exec", branch: "false" },
      { id: "e6", source: "llm_summary", target: "human_review" },
      { id: "e7", source: "human_review", target: "end_node" },
      { id: "e8", source: "subagent_exec", target: "end_node" },
    ],
  };

  it("1. should render all 8+ nodes and their types/ids correctly", () => {
    render(<WorkflowCanvas dsl={sample8NodeDSL} />);

    // 检查所有 8 个节点是否都被渲染出来
    for (const node of sample8NodeDSL.nodes) {
      const nodeEl = screen.getByTestId(`workflow-node-${node.id}`);
      expect(nodeEl).toBeInTheDocument();
      expect(nodeEl).toHaveAttribute("data-node-id", node.id);
      expect(nodeEl).toHaveAttribute("data-node-type", node.type);
    }
  });

  it("2. should render branch edge labels (e.g. 'true', 'false')", async () => {
    render(<WorkflowCanvas dsl={sample8NodeDSL} />);

    // 检查 branch 边标签渲染
    const trueLabel = await screen.findByText("true");
    const falseLabel = await screen.findByText("false");

    expect(trueLabel).toBeInTheDocument();
    expect(falseLabel).toBeInTheDocument();

    const edgeTrue = screen.getByTestId("edge-label-e4");
    expect(edgeTrue).toHaveAttribute("data-branch", "true");

    const edgeFalse = screen.getByTestId("edge-label-e5");
    expect(edgeFalse).toHaveAttribute("data-branch", "false");
  });

  it("3. should update node status class and data-status when nodeStates prop changes", () => {
    const initialStates = {
      start_node: { status: "success" },
      fetch_data: { status: "running" },
      process_data: { status: "pending" },
    };

    const { rerender } = render(
      <WorkflowCanvas dsl={sample8NodeDSL} nodeStates={initialStates} />
    );

    const startNode = screen.getByTestId("workflow-node-start_node");
    const fetchNode = screen.getByTestId("workflow-node-fetch_data");
    const processNode = screen.getByTestId("workflow-node-process_data");
    const humanNode = screen.getByTestId("workflow-node-human_review");

    expect(startNode).toHaveClass("status-success");
    expect(startNode).toHaveAttribute("data-status", "success");

    expect(fetchNode).toHaveClass("status-running");
    expect(fetchNode).toHaveAttribute("data-status", "running");

    expect(processNode).toHaveClass("status-pending");
    expect(processNode).toHaveAttribute("data-status", "pending");

    // 默认没有在 nodeStates 中指定的状态应为 pending
    expect(humanNode).toHaveClass("status-pending");
    expect(humanNode).toHaveAttribute("data-status", "pending");

    // 状态切换：fetch_data 完成，process_data 失败，human_review 等待审批，subagent 略过
    const updatedStates = {
      start_node: { status: "success" },
      fetch_data: { status: "success" },
      process_data: { status: "failed" },
      human_review: { status: "waiting_human" },
      subagent_exec: { status: "skipped" },
    };

    rerender(
      <WorkflowCanvas dsl={sample8NodeDSL} nodeStates={updatedStates} />
    );

    expect(screen.getByTestId("workflow-node-fetch_data")).toHaveClass("status-success");
    expect(screen.getByTestId("workflow-node-process_data")).toHaveClass("status-failed");
    expect(screen.getByTestId("workflow-node-human_review")).toHaveClass("status-waiting_human");
    expect(screen.getByTestId("workflow-node-subagent_exec")).toHaveClass("status-skipped");
  });

  it("4. should render all 21 node types with corresponding icons and text", () => {
    const allTypesDSL: WorkflowDSL = {
      version: "dsh.workflow.v1",
      name: "all-21-node-types",
      nodes: ALL_NODE_TYPES.map((t, idx) => ({
        id: `node_${idx}_${t}`,
        type: t as NodeType,
        ...(t === "code" ? { code: "1" } : {}),
        ...(t === "template" ? { template: "hi" } : {}),
        ...(t === "llm" ? { prompt: "hi" } : {}),
        ...(t === "human" ? { prompt: "hi" } : {}),
        ...(t === "subagent" ? { prompt: "hi" } : {}),
        ...(t === "plugin_tool" ? { toolName: "tool" } : {}),
        ...(t === "if_else" ? { condition: "true" } : {}),
        ...(t === "iteration" ? { over: "items" } : {}),
        ...(t === "set_variable" ? { assignments: [{ key: "a", value: "b" }] } : {}),
      })),
      edges: [],
    };

    render(<WorkflowCanvas dsl={allTypesDSL} />);

    for (let i = 0; i < ALL_NODE_TYPES.length; i++) {
      const type = ALL_NODE_TYPES[i];
      const nodeId = `node_${i}_${type}`;
      const nodeEl = screen.getByTestId(`workflow-node-${nodeId}`);
      expect(nodeEl).toBeInTheDocument();
      expect(nodeEl).toHaveAttribute("data-node-type", type);
      expect(NODE_TYPE_ICONS[type]).toBeDefined();
    }
  });

  it("5. should support onNodeClick callback when node is clicked", () => {
    const onNodeClick = vi.fn();
    render(
      <WorkflowCanvas dsl={sample8NodeDSL} onNodeClick={onNodeClick} />
    );

    const llmNode = screen.getByTestId("workflow-node-llm_summary");
    llmNode.click();

    expect(onNodeClick).toHaveBeenCalledTimes(1);
    expect(onNodeClick).toHaveBeenCalledWith("llm_summary", expect.objectContaining({
      id: "llm_summary",
      type: "llm",
    }));
  });

  it("6. should support client plugin activation slot registration", () => {
    const registerMock = vi.fn();
    activate({
      slots: {
        register: registerMock,
      },
    });

    expect(registerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "workflow-canvas",
        title: "Workflow Canvas",
        icon: "git-merge",
      })
    );
  });
});
