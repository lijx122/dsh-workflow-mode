/** 循环属性面板（over 引用 + 上限 + body 子图 JSON）。 */
import React from "react";
import { Field, NameField, TextInput, TextArea, OutputBox } from "../shared/panel-kit.js";
import styles from "../../node-styles.module.css";
import { meta } from "./default.js";
import type { NodePanelProps } from "../../types.js";
import type { IterationNode } from "./types.js";

export function IterationPanel(props: NodePanelProps<IterationNode>): React.ReactElement {
  const { node, onChange, runState } = props;
  void styles; void meta;
  let bodyText = "";
  try { bodyText = node.body === undefined ? "" : JSON.stringify(node.body, null, 2); } catch { bodyText = ""; }
  return (
    <>
      <NameField node={node} onChange={onChange} />
      <Field label="over 数组引用" extra="上游输出路径">
        <TextInput value={node.over} placeholder="如 preprocess.chunks" onChange={(over) => onChange({ ...node, over })} />
      </Field>
      <Field label="最大迭代次数">
        <TextInput
          value={String(node.maxIterations ?? "")}
          placeholder="默认 100"
          onChange={(v) => { const n = Number(v); onChange({ ...node, maxIterations: Number.isFinite(n) && v.trim() !== "" ? n : undefined }); }}
        />
      </Field>
      <Field label="body 子图" extra="JSON · 内联串行执行 §10.16">
        <TextArea
          value={bodyText}
          rows={5}
          placeholder='{"nodes":[...],"edges":[...]}'
          onChange={(text) => {
            try { onChange({ ...node, body: text.trim() === "" ? undefined : JSON.parse(text) }); } catch { /* 非法 JSON 暂不落盘 */ }
          }}
        />
      </Field>
      <OutputBox runState={runState} />
    </>
  );
}
