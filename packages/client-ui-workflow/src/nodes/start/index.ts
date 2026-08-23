/** 开始四件套组装：default/types/card/panel → 完整 NodeDefinition。 */
import type { NodeDefinition } from "../../types.js";
import { meta } from "./default.js";
import { StartCard } from "./card.js";
import { StartPanel } from "./panel.js";

const definition: NodeDefinition = {
  ...meta,
  CardComponent: StartCard,
  PanelComponent: StartPanel,
};

export default definition;
export { meta };
