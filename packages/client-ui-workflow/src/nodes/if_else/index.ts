/** 条件分支四件套组装：default/types/card/panel → 完整 NodeDefinition。 */
import type { NodeDefinition } from "../../types.js";
import { meta } from "./default.js";
import { IfElseCard } from "./card.js";
import { IfElsePanel } from "./panel.js";

const definition: NodeDefinition = {
  ...meta,
  CardComponent: IfElseCard,
  PanelComponent: IfElsePanel,
};

export default definition;
export { meta };
