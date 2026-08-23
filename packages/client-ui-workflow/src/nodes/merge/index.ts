/** 合并四件套组装：default/types/card/panel → 完整 NodeDefinition。 */
import type { NodeDefinition } from "../../types.js";
import { meta } from "./default.js";
import { MergeCard } from "./card.js";
import { MergePanel } from "./panel.js";

const definition: NodeDefinition = {
  ...meta,
  CardComponent: MergeCard,
  PanelComponent: MergePanel,
};

export default definition;
export { meta };
