/** 结束四件套组装：default/types/card/panel → 完整 NodeDefinition。 */
import type { NodeDefinition } from "../../types.js";
import { meta } from "./default.js";
import { EndCard } from "./card.js";
import { EndPanel } from "./panel.js";

const definition: NodeDefinition = {
  ...meta,
  CardComponent: EndCard,
  PanelComponent: EndPanel,
};

export default definition;
export { meta };
