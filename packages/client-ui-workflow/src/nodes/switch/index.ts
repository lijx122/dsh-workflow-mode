/** 多路分支四件套组装：default/types/card/panel → 完整 NodeDefinition。 */
import type { NodeDefinition } from "../../types.js";
import { meta } from "./default.js";
import { SwitchCard } from "./card.js";
import { SwitchPanel } from "./panel.js";

const definition: NodeDefinition = {
  ...meta,
  CardComponent: SwitchCard,
  PanelComponent: SwitchPanel,
};

export default definition;
export { meta };
