/** 人工审批属性面板（断点说明 / 超时策略，§5.1 断点暂停）。 */
import React from "react";
import { Field, NameField, TextInput, TextArea, Select, OutputBox } from "../shared/panel-kit.js";
import styles from "../../node-styles.module.css";
import { meta } from "./default.js";
import type { NodePanelProps } from "../../types.js";
import type { HumanNode } from "./types.js";

export function HumanPanel(props: NodePanelProps<HumanNode>): React.ReactElement {
  const { node, onChange, runState } = props;
  void styles; void meta;
  return (
    <>
      <NameField node={node} onChange={onChange} />
      <Field label="审批提示文案">
        <TextArea
          value={node.prompt}
          rows={4}
          placeholder="向审批人展示的说明"
          onChange={(prompt) => onChange({ ...node, prompt })}
        />
      </Field>
      <Field label="超时时间" extra="ms · 留空不超时">
        <TextInput
          value={node.timeoutMs === undefined ? "" : String(node.timeoutMs)}
          placeholder="如 600000"
          onChange={(v) => { const n = Number(v); onChange({ ...node, timeoutMs: v.trim() !== "" && Number.isFinite(n) ? n : undefined }); }}
        />
      </Field>
      <Field label="超时策略">
        <Select
          value={node.onTimeout ?? "proceed"}
          options={[
            { value: "proceed", label: "proceed（放行继续）" },
            { value: "abort", label: "abort（终止运行）" },
          ]}
          onChange={(v) => onChange({ ...node, onTimeout: v as "abort" | "proceed" })}
        />
      </Field>
      <OutputBox runState={runState} />
    </>
  );
}
