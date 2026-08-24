/**
 * LLM 属性面板（§10.1 模型降级开关）：
 * 探得 dsh-client-ui-model-selection 数据源 → 可编辑下拉；
 * 探不得 → 只读展示会话当前模型，仅提示词可编辑。
 */
import React, { useMemo } from "react";
import { Field, NameField, TextInput, TextArea, Select, Slider, OutputBox } from "../shared/panel-kit.js";
import { probeModelCatalog, resolveModelDisplay } from "../shared/model-source.js";
import styles from "../../node-styles.module.css";
import { meta } from "./default.js";
import type { NodePanelProps } from "../../types.js";
import type { LlmNode, LlmInputsView } from "./types.js";

export function LlmPanel(props: NodePanelProps<LlmNode>): React.ReactElement {
  const { node, onChange, runState, context } = props;
  void styles; void meta;
  const catalog = useMemo(
    () => context?.modelCatalog ?? probeModelCatalog(),
    [context?.modelCatalog],
  );
  const inputs = (node.inputs ?? {}) as LlmInputsView;
  const temperature = typeof inputs.temperature === "number" ? inputs.temperature : 0.7;

  let schemaText = "";
  try { schemaText = node.outputSchema === undefined ? "" : JSON.stringify(node.outputSchema, null, 2); } catch { schemaText = ""; }

  return (
    <>
      <NameField node={node} onChange={onChange} />
      <Field label="推理模型" extra={catalog.available ? catalog.source : "\u00a710.1 降级"}>
        {catalog.available ? (
          <Select
            value={typeof node.model === "string" ? node.model : ""}
            options={[
              { value: "", label: "(跟随会话)" },
              ...catalog.models.map((m) => ({ value: m.id, label: m.label })),
            ]}
            onChange={(v) => onChange({ ...node, model: v === "" ? undefined : v })}
          />
        ) : (
          <>
            <TextInput readOnly value={resolveModelDisplay(node.model, context?.sessionModelId)} />
            <p className={styles.hint}>未探测到模型选择数据源，已按 §10.1 降级为只读展示；仅提示词可编辑。</p>
          </>
        )}
      </Field>
      <Field label="System 提示词">
        <TextArea
          value={node.systemPrompt ?? ""}
          rows={5}
          placeholder="设定角色与输出结构"
          onChange={(systemPrompt) => onChange({ ...node, systemPrompt })}
        />
      </Field>
      <Field label="User 提示词">
        <TextArea
          value={node.prompt ?? ""}
          rows={4}
          placeholder="如: 分析工单意图与等级：{{#start_1.ticket}}"
          onChange={(prompt) => onChange({ ...node, prompt })}
        />
      </Field>
      <Field label="Temperature（发散度）">
        <Slider
          value={temperature}
          min={0}
          max={1}
          step={0.1}
          onChange={(v) => onChange({ ...node, inputs: { ...inputs, temperature: v } })}
        />
      </Field>
      <Field label="输出 JSON Schema" extra="可选">
        <TextArea
          value={schemaText}
          rows={3}
          placeholder='{"type":"object",...}'
          onChange={(text) => {
            try { onChange({ ...node, outputSchema: text.trim() === "" ? undefined : JSON.parse(text) }); } catch { /* 非法 JSON 暂不落盘 */ }
          }}
        />
      </Field>
      <OutputBox runState={runState} />
    </>
  );
}
