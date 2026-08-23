/** 开始属性面板（输入参数表：名称只读 + 类型选择，§4.2）。 */
import React from "react";
import {
  Field,
  NameField,
  Select,
  OutputBox,
  RowLine,
  AddRowButton,
} from "../shared/panel-kit.js";
import { meta } from "./default.js";
import type { NodePanelProps } from "../../types.js";
import type { StartNode } from "./types.js";

type StartInputs = NonNullable<StartNode["inputs"]>;
type ParamType = "string" | "number" | "boolean" | "object";

export function StartPanel(props: NodePanelProps<StartNode>): React.ReactElement {
  const { node, onChange, runState } = props;
  void meta;
  const record = (node.inputs ?? {}) as StartInputs;
  const write = (next: StartInputs): void => onChange({ ...node, inputs: next });
  const PARAM_TYPES: { value: ParamType; label: string }[] = [
    { value: "string", label: "string" },
    { value: "number", label: "number" },
    { value: "boolean", label: "boolean" },
    { value: "object", label: "object" },
  ];
  return (
    <>
      <NameField node={node} onChange={onChange} />
      {Object.keys(record).map((key) => {
        const spec = record[key];
        return (
          <RowLine key={key} onRemove={() => { const next = { ...record }; delete next[key]; write(next); }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Field label={key}>
                <Select
                  value={typeof spec?.type === "string" ? spec.type : "string"}
                  options={PARAM_TYPES}
                  onChange={(t) => write({ ...record, [key]: { ...(spec ?? {}), type: t as ParamType } })}
                />
              </Field>
            </div>
          </RowLine>
        );
      })}
      <AddRowButton
        label="+ 添加输入参数"
        onClick={() => write({ ...record, ["param_" + Date.now().toString(36).slice(-4)]: { type: "string" } })}
      />
      <OutputBox runState={runState} />
    </>
  );
}
