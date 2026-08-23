/** 代码执行属性面板（JS 编辑器 + 受限沙箱提示，§10.16 new Function 方案）。 */
import React from "react";
import { Field, NameField, TextArea, OutputBox } from "../shared/panel-kit.js";
import styles from "../../node-styles.module.css";
import { meta } from "./default.js";
import type { NodePanelProps } from "../../types.js";
import type { CodeNode } from "./types.js";

export function CodePanel(props: NodePanelProps<CodeNode>): React.ReactElement {
  const { node, onChange, runState } = props;
  void styles; void meta;
  return (
    <>
      <NameField node={node} onChange={onChange} />
      <Field label="JavaScript 代码" extra="js">
        <TextArea
          value={node.code}
          rows={8}
          placeholder={"// 输入变量可直接引用\nreturn { result: input };"} 
          onChange={(code) => onChange({ ...node, code })}
        />
      </Field>
      <p className={styles.hint}>受限沙箱执行：仅 console / Math / JSON 与输入变量可用，禁网络与 DOM（§10.16）。</p>
      <OutputBox runState={runState} />
    </>
  );
}
