/** 条件分支属性面板（expr 编辑，expr-eval 方言）。 */
import React from "react";
import { Field, NameField, TextArea, OutputBox } from "../shared/panel-kit.js";
import styles from "../../node-styles.module.css";
import { meta } from "./default.js";
import type { NodePanelProps } from "../../types.js";
import type { IfElseNode } from "./types.js";

export function IfElsePanel(props: NodePanelProps<IfElseNode>): React.ReactElement {
  const { node, onChange, runState } = props;
  void styles; void meta;
  return (
    <>
      <NameField node={node} onChange={onChange} />
      <Field label="条件表达式" extra="expr-eval 方言">
        <TextArea
          value={node.condition}
          rows={3}
          placeholder="例: user_tier == 'VIP' && severity == 'P0'"
          onChange={(condition) => onChange({ condition })}
        />
      </Field>
      <p className={styles.hint}>true / false 分支经卡片右侧 T / F 双端口连出。</p>
      <OutputBox runState={runState} />
    </>
  );
}
