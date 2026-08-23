/** 循环四件套组装：default/types/card/panel → 完整 NodeDefinition。 */
import type { NodeDefinition } from "../../types.js";
import { meta } from "./default.js";
import { IterationCard } from "./card.js";
import { IterationPanel } from "./panel.js";

const definition: NodeDefinition = {
  ...meta,
  CardComponent: IterationCard,
  PanelComponent: IterationPanel,
};

export default definition;
export { meta };
