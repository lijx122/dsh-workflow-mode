/**
 * 属性面板表单件（M2 共享件，§4.2 面板字段统一视觉）。
 * 输入框统一 layer-2 底 / border-l2 / 圆角 8 / 聚焦品牌蓝（样式见 node-styles.module.css）。
 */
import React from "react";
import type { NodePanelProps } from "../../types.js";
import type { WorkflowNode } from "@dsh-workflow/schema";
import styles from "../../node-styles.module.css";

export function Field({ label, extra, children }: { label: string; extra?: string; children: React.ReactNode }) {
  return (
    <div className={styles.field}>
      <label className={styles.label}>
        <span>{label}</span>
        {extra !== undefined && <span className={styles.labelExtra}>{extra}</span>}
      </label>
      {children}
    </div>
  );
}

interface TextInputProps {
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  rows?: never;
}

export function TextInput({ value, onChange, placeholder, readOnly }: TextInputProps) {
  return (
    <input
      className={styles.input}
      type="text"
      value={value}
      placeholder={placeholder}
      readOnly={readOnly}
      onChange={(e) => onChange?.(e.target.value)}
    />
  );
}

export function TextArea({ value, onChange, placeholder, rows = 4 }: {
  value: string; onChange?: (value: string) => void; placeholder?: string; rows?: number;
}) {
  return (
    <textarea
      className={styles.textarea}
      value={value}
      rows={rows}
      placeholder={placeholder}
      onChange={(e) => onChange?.(e.target.value)}
    />
  );
}

export interface SelectOption { value: string; label: string }

export function Select({ value, onChange, options }: {
  value: string; onChange?: (value: string) => void; options: SelectOption[];
}) {
  return (
    <select
      className={styles.select}
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function Slider({ value, onChange, min = 0, max = 1, step = 0.1 }: {
  value: number; onChange?: (value: number) => void; min?: number; max?: number; step?: number;
}) {
  return (
    <div className={styles.sliderRow}>
      <input
        className={styles.slider}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange?.(Number(e.target.value))}
      />
      <span className={styles.sliderVal}>{value}</span>
    </div>
  );
}

/** 运行输出 JSON 块（§5.2 右侧面板「运行输出」）。 */
export function OutputBox({ runState }: { runState?: NodeStateInfoLike }) {
  if (!runState) return null;
  const payload = { status: runState.status, durationMs: runState.durationMs, outputs: runState.outputs, error: runState.error };
  return <div className={styles.outputBox}>{JSON.stringify(payload, null, 2)}</div>;
}

interface NodeStateInfoLike {
  status: string;
  outputs?: Record<string, unknown>;
  durationMs?: number;
  error?: string;
}

/** 通用节点名称字段（所有面板共用首项）。 */
export function NameField<P extends WorkflowNode>({ node, onChange }: NodePanelProps<P>) {
  return (
    <Field label="节点名称">
      <TextInput
        value={typeof node.name === "string" ? node.name : ""}
        onChange={(name) => onChange({ name } as Partial<P>)}
      />
    </Field>
  );
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export { asString };

/** 键值行编辑器骨架（start/end/set_variable/switch 复用）。 */
export function RowLine({ children, onRemove }: { children: React.ReactNode; onRemove?: () => void }) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
      {children}
      {onRemove && (
        <button
          type="button"
          className={styles.zoomBtn}
          title="删除此行"
          aria-label="删除此行"
          onClick={onRemove}
        >
          ✕
        </button>
      )}
    </div>
  );
}

export function AddRowButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className={styles.input}
      style={{ cursor: "pointer", textAlign: "center", background: "var(--hover-fill)" }}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
