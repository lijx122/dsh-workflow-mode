/** 条件分支画布缩略卡（双端口 T/F 由 handles 驱动）。 */
import React from "react";
import { BaseNodeCard, truncate } from "../shared/card-shell.js";
import { meta } from "./default.js";
import type { NodeCardProps } from "../../types.js";

export function IfElseCard(props: NodeCardProps): React.ReactElement {
  return <BaseNodeCard def={meta} {...props} />;
}
void truncate;
