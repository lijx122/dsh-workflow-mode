/** 合并属性面板（strategy 选择）。 */
import React from "react";
import { Field, NameField, Select, OutputBox } from "../shared/panel-kit.js";
import styles from "../../node-styles.module.css";
import { meta } from "./default.js";
import type { NodePanelProps } from "../../types.js";
import type { MergeNode } from "./types.js";

export function MergePanel(props: NodePanelProps<MergeNode>): React.ReactElement {
  const { node, onChange, runState } = props;
  void styles; void meta;
  return (
    <>
      <NameField node={node} onChange={onChange} />
      <Field label="合并策略">
        <Select
          value={typeof node.strategy === "string" ? node.strategy : "shallow"}
          options={[
            { value: "shallow", label: "shallow（浅合并）" },
            { value: "deep", label: "deep（深合并）" },
          ]}
          onChange={(v) => onChange({ ...node, strategy: v as "shallow" | "deep" })}
        />
      </Field>
      <OutputBox runState={runState} />
    </>
  );
}
