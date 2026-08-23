/** 文本模板属性面板（Jinja-like 模板文本）。 */
import React from "react";
import { Field, NameField, TextArea, OutputBox } from "../shared/panel-kit.js";
import styles from "../../node-styles.module.css";
import { meta } from "./default.js";
import type { NodePanelProps } from "../../types.js";
import type { TemplateNode } from "./types.js";

export function TemplatePanel(props: NodePanelProps<TemplateNode>): React.ReactElement {
  const { node, onChange, runState } = props;
  void styles; void meta;
  return (
    <>
      <NameField node={node} onChange={onChange} />
      <Field label="模板文本" extra="Jinja-like">
        <TextArea
          value={node.template}
          rows={6}
          placeholder={"您好 {{name}}，处理结果如下：{{result}}"}
          onChange={(template) => onChange({ ...node, template })}
        />
      </Field>
      <OutputBox runState={runState} />
    </>
  );
}
