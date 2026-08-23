/** LLM 画布缩略卡：卡内嵌只读模型小字（§4.1 Dify 形态 / §10.1 降级展示）。 */
import React from "react";
import { BaseNodeCard } from "../shared/card-shell.js";
import { resolveModelDisplay } from "../shared/model-source.js";
import styles from "../../node-styles.module.css";
import { meta } from "./default.js";
import type { NodeCardProps } from "../../types.js";

export function LlmCard(props: NodeCardProps): React.ReactElement {
  const model = resolveModelDisplay((props.node as { model?: unknown }).model, undefined);
  void meta;
  return (
    <BaseNodeCard def={meta} {...props}>
      <div className={styles.subtext}>{"model: " + model}</div>
    </BaseNodeCard>
  );
}
