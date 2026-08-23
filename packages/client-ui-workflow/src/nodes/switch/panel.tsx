/** 多路分支属性面板（case 列表 + 默认分支）。 */
import React from "react";
import { Field, NameField, TextInput, OutputBox, RowLine, AddRowButton } from "../shared/panel-kit.js";
import styles from "../../node-styles.module.css";
import { meta } from "./default.js";
import type { NodePanelProps } from "../../types.js";
import type { SwitchNode } from "./types.js";

type CaseItem = string | { when?: string; condition?: string; value?: string; target?: string };

function readCase(item: CaseItem): { when: string; target: string } {
  if (typeof item === "string") return { when: item, target: item };
  return { when: item.when ?? item.condition ?? "", target: item.target ?? "" };
}

export function SwitchPanel(props: NodePanelProps<SwitchNode>): React.ReactElement {
  const { node, onChange, runState } = props;
  void styles; void meta;
  const rawCases = (node.cases ?? []) as CaseItem[];
  const writeCases = (rows: { when: string; target: string }[]) => {
    onChange({ ...node, cases: rows.map((r) => ({ when: r.when, target: r.target })) });
  };
  return (
    <>
      <NameField node={node} onChange={onChange} />
      {rawCases.map((item, i) => {
        const c = readCase(item);
        return (
          <RowLine key={i} onRemove={() => writeCases(rawCases.filter((_, j) => j !== i).map(readCase))}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Field label={"when #" + (i + 1)}>
                <TextInput value={c.when} placeholder="匹配值/条件" onChange={(when) => writeCases(rawCases.map((x, j) => (j === i ? { ...readCase(x), when } : readCase(x))))} />
              </Field>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Field label="target">
                <TextInput value={c.target} placeholder="目标节点 id" onChange={(target) => writeCases(rawCases.map((x, j) => (j === i ? { ...readCase(x), target } : readCase(x))))} />
              </Field>
            </div>
          </RowLine>
        );
      })}
      <AddRowButton label="+ 添加 case" onClick={() => writeCases([...rawCases.map(readCase), { when: "", target: "" }])} />
      <Field label="默认分支 target">
        <TextInput
          value={typeof node.defaultCase === "string" ? node.defaultCase : typeof node.default === "string" ? node.default : ""}
          onChange={(v) => onChange({ ...node, defaultCase: v })}
        />
      </Field>
      <OutputBox runState={runState} />
    </>
  );
}
