/** 变量赋值属性面板（key = value 行编辑）。 */
import React from "react";
import { Field, NameField, TextInput, OutputBox, RowLine, AddRowButton } from "../shared/panel-kit.js";
import styles from "../../node-styles.module.css";
import { meta } from "./default.js";
import type { NodePanelProps } from "../../types.js";
import type { SetVariableNode } from "./types.js";

export function SetVariablePanel(props: NodePanelProps<SetVariableNode>): React.ReactElement {
  const { node, onChange, runState } = props;
  void styles; void meta;
  const rows = node.assignments ?? [];
  const write = (list: { key: string; value: string }[]) => onChange({ ...node, assignments: list });
  return (
    <>
      <NameField node={node} onChange={onChange} />
      {rows.map((a, i) => (
        <RowLine key={i} onRemove={() => write(rows.filter((_, j) => j !== i))}>
          <div style={{ width: 84 }}><TextInput value={a.key} placeholder="变量名" onChange={(key) => write(rows.map((x, j) => (j === i ? { ...x, key } : x)))} /></div>
          <div style={{ flex: 1, minWidth: 0 }}><TextInput value={a.value} placeholder="值 / 表达式引用" onChange={(value) => write(rows.map((x, j) => (j === i ? { ...x, value } : x)))} /></div>
        </RowLine>
      ))}
      <AddRowButton label="+ 添加赋值" onClick={() => write([...rows, { key: "", value: "" }])} />
      <OutputBox runState={runState} />
    </>
  );
}
