/** 变量赋值四件套组装：default/types/card/panel → 完整 NodeDefinition。 */
import type { NodeDefinition } from "../../types.js";
import { meta } from "./default.js";
import { SetVariableCard } from "./card.js";
import { SetVariablePanel } from "./panel.js";

const definition: NodeDefinition = {
  ...meta,
  CardComponent: SetVariableCard,
  PanelComponent: SetVariablePanel,
};

export default definition;
export { meta };
