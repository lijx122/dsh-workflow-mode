/** 结束属性面板（输出映射：变量 ← 引用，§4.2）。 */
import React from "react";
import {
  Field,
  NameField,
  TextInput,
  OutputBox,
  RowLine,
  AddRowButton,
  asString,
} from "../shared/panel-kit.js";
import { meta } from "./default.js";
import type { NodePanelProps } from "../../types.js";
import type { EndNode } from "./types.js";

type EndOutputs = NonNullable<EndNode["outputs"]>;

export function EndPanel(props: NodePanelProps<EndNode>): React.ReactElement {
  const { node, onChange, runState } = props;
  void meta;
  const outs = (node.outputs ?? {}) as EndOutputs;
  const write = (next: EndOutputs): void => onChange({ ...node, outputs: next });
  return (
    <>
      <NameField node={node} onChange={onChange} />
      {Object.entries(outs).map(([key, ref]) => (
        <RowLine key={key} onRemove={() => { const next = { ...outs }; delete next[key]; write(next); }}>
          <div style={{ width: 84 }}><TextInput value={key} readOnly /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <TextInput
              value={asString(ref)}
              placeholder="变量引用，如 {{#llm_1.text}}"
              onChange={(v) => write({ ...outs, [key]: v })}
            />
          </div>
        </RowLine>
      ))}
      <AddRowButton
        label="+ 添加输出映射"
        onClick={() => write({ ...outs, ["out_" + Date.now().toString(36).slice(-4)]: "" })}
      />
      <OutputBox runState={runState} />
    </>
  );
}
