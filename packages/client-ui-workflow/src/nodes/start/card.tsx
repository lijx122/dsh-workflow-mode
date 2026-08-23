/** 开始 画布缩略卡（共享壳 + 类型徽章/副标题，§10.20 五要素）。 */
import React from "react";
import { BaseNodeCard } from "../shared/card-shell.js";
import { meta } from "./default.js";
import type { NodeCardProps } from "../../types.js";

export function StartCard(props: NodeCardProps): React.ReactElement {
  return <BaseNodeCard def={meta} {...props} />;
}
