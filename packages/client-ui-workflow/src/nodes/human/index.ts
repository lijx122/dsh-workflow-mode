/** 人工审批四件套组装：default/types/card/panel → 完整 NodeDefinition。 */
import type { NodeDefinition } from "../../types.js";
import { meta } from "./default.js";
import { HumanCard } from "./card.js";
import { HumanPanel } from "./panel.js";

const definition: NodeDefinition = {
  ...meta,
  CardComponent: HumanCard,
  PanelComponent: HumanPanel,
};

export default definition;
export { meta };
