/** 子 Agent 属性面板（工作区选择器 + 预设选择 + 任务 prompt）。 */
import React from "react";
import { Field, NameField, TextInput, TextArea, Select, OutputBox } from "../shared/panel-kit.js";
import styles from "../../node-styles.module.css";
import { meta } from "./default.js";
import type { NodePanelProps } from "../../types.js";
import type { SubagentNode, SubagentInputsView } from "./types.js";

export function SubagentPanel(props: NodePanelProps<SubagentNode>): React.ReactElement {
  const { node, onChange, runState, context } = props;
  void styles; void meta;
  const inputs = (node.inputs ?? {}) as SubagentInputsView;
  return (
    <>
      <NameField node={node} onChange={onChange} />
      <Field label="工作区" extra={context ? undefined : "手填"}>
        <TextInput
          value={inputs.workspace ?? ""}
          placeholder="宿主工作区 / 子 Agent 文件夹路径"
          onChange={(workspace) => onChange({ ...node, inputs: { ...inputs, workspace } })}
        />
      </Field>
      <Field label="Agent 预设">
        <Select
          value={typeof node.preset === "string" ? node.preset : "standard"}
          options={[
            { value: "standard", label: "standard（标准）" },
            { value: "workflow", label: "workflow（工作流模式）" },
          ]}
          onChange={(v) => onChange({ ...node, preset: v })}
        />
      </Field>
      <Field label="任务 prompt">
        <TextArea
          value={node.prompt}
          rows={5}
          placeholder="投递给子 Agent 的完整任务描述"
          onChange={(prompt) => onChange({ ...node, prompt })}
        />
      </Field>
      <OutputBox runState={runState} />
    </>
  );
}
